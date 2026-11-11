import threading
import uuid

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.core.models import IdempotencyRecord
from apps.inventory.models import StockMovement
from apps.sales.models import Order, Refund, RefundLine
from apps.shifts.models import CashierShift
from conftest import client_for, data, make_user

from .conftest import card, cash, close_shift, open_shift, refund, sell

pytestmark = pytest.mark.django_db


def state():
    return (
        Refund.objects.count(),
        RefundLine.objects.count(),
        AuditEvent.objects.filter(action="refund.created").count(),
        IdempotencyRecord.objects.filter(scope__startswith="refund:").count(),
        Order.objects.filter(status="refunded").count(),
        StockMovement.objects.count(),
    )


@pytest.fixture
def shift(barista_c):
    return open_shift(barista_c, "100.00")


def test_at14_cash_refund_keeps_the_invoice_and_audits_the_reason(barista_c, shop, shift, barista):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    before = barista_c.get(f"/api/v1/orders/{oid}").json()["data"]
    movements = StockMovement.objects.count()
    r = refund(barista_c, oid, "65.00", "  Customer changed mind ")
    assert r.status_code == 201, r.content
    d = data(r)
    assert d["status"] == "refunded" and d["total_amount"] == "65.00"
    assert d["order_status"] == "refunded"  # Q6 1B: the spec 9.4 name is sent too
    assert d["lines"] == [{"method": "cash", "amount": "65.00", "external_reference": ""}]
    assert d["inventory_restored"] is False and d["shift_id"] == shift["id"]
    after = barista_c.get(f"/api/v1/orders/{oid}").json()["data"]
    assert after["refund"]["reason"] == "Customer changed mind"
    assert after["refund"]["actor"]["id"] == str(barista.pk)
    # the original invoice is untouched apart from its status
    strip = lambda o: {k: v for k, v in o.items() if k not in ("status", "refund")}  # noqa: E731
    assert strip(after) == strip(before) and after["status"] == "refunded"
    assert StockMovement.objects.count() == movements  # spec 8.6: no stock restoration
    ev = AuditEvent.objects.get(action="refund.created")
    assert ev.actor == barista and ev.summary["reason"] == "Customer changed mind"
    assert ev.summary["invoice_no"] == before["invoice_no"]
    assert ev.summary["original_cashier_id"] == str(barista.pk)
    assert ev.summary["lines"] == [{"method": "cash", "amount": "65.00"}]
    # the receipt shows the refund too
    assert barista_c.get(f"/api/v1/orders/{oid}/receipt").json()["data"]["refund"]["total_amount"]


def test_at15_same_key_replays_a_new_key_is_409(barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    key = uuid.uuid4()
    first = refund(barista_c, oid, "65.00", key=key)
    again = refund(barista_c, oid, "65.00", key=key)
    assert first.status_code == again.status_code == 201
    assert again["Idempotent-Replayed"] == "true" and again.json() == first.json()
    assert Refund.objects.count() == 1
    other = refund(barista_c, oid, "65.00")
    assert other.status_code == 409 and other.json()["error"]["code"] == "REFUND_ALREADY_APPLIED"
    assert (
        Refund.objects.count() == 1
        and AuditEvent.objects.filter(action="refund.created").count() == 1
    )


def test_same_key_with_another_payload_or_user_is_a_conflict(org, barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    key = uuid.uuid4()
    assert refund(barista_c, oid, "65.00", key=key).status_code == 201
    r = refund(barista_c, oid, "65.00", "A different reason", key=key)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    other = client_for(make_user(org, "other", "barista"))
    r = refund(other, oid, "65.00", key=key)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_mixed_order_is_refunded_to_the_original_methods_and_amounts(barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("20.00"), card("45.00", "TERM-9")], "65.00")
    r = refund(barista_c, oid, "65.00", card_external_reference="REF-77")
    assert r.status_code == 201, r.content
    assert data(r)["lines"] == [
        {"method": "cash", "amount": "20.00", "external_reference": ""},
        {"method": "card", "amount": "45.00", "external_reference": "REF-77"},
    ]
    lines = {ln.method: ln for ln in RefundLine.objects.all()}
    assert lines["cash"].original_payment.method == "cash"
    assert lines["card"].original_payment.amount == lines["card"].amount


def test_cash_refund_without_an_open_shift_is_409_and_changes_nothing(
    org, barista_c, shop, shift, admin_c
):
    oid = sell(barista_c, shop, [cash("20.00"), card("45.00")], "65.00")
    before = state()
    r = refund(admin_c, oid, "65.00")  # the admin has no open shift
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    assert state() == before and Order.objects.get().status == "paid"
    # the idempotency record rolled back too, so the same key may be retried after opening a shift
    key = uuid.uuid4()
    assert refund(admin_c, oid, "65.00", key=key).status_code == 409
    open_shift(admin_c)
    assert refund(admin_c, oid, "65.00", key=key).status_code == 201


def test_card_only_refund_needs_no_shift_and_has_no_shift_when_none_is_open(
    barista_c, shop, shift, admin_c
):
    oid = sell(barista_c, shop, [card("65.00")], "65.00")
    r = refund(admin_c, oid, "65.00")
    assert r.status_code == 201 and data(r)["shift_id"] is None
    assert Refund.objects.get().shift is None


def test_card_only_refund_by_a_user_with_a_shift_attaches_that_shift(barista_c, shop, shift):
    oid = sell(barista_c, shop, [card("65.00")], "65.00")
    assert data(refund(barista_c, oid, "65.00"))["shift_id"] == shift["id"]


@pytest.mark.parametrize("amount", ["30.00", "65.01", "0.00"])
def test_partial_amount_is_rejected(barista_c, shop, shift, amount):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    before = state()
    r = refund(barista_c, oid, amount)
    assert r.status_code == 422 and r.json()["error"]["code"] == "PARTIAL_REFUND_NOT_SUPPORTED"
    assert state() == before


@pytest.mark.parametrize(
    "body",
    [
        {"reason": "ab", "confirm_amount": "65.00"},
        {"reason": "   ", "confirm_amount": "65.00"},
        {"confirm_amount": "65.00"},
        {"reason": "ok ok"},
        {"reason": "ok ok", "confirm_amount": 65},
        {"reason": "ok ok", "confirm_amount": "65.00", "extra": 1},
        {"reason": "ok ok", "confirm_amount": "65.00", "card_external_reference": "X"},  # cash only
    ],
)
def test_refund_validation(barista_c, shop, shift, body):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    before = state()
    r = barista_c.post(
        f"/api/v1/orders/{oid}/refunds",
        body,
        format="json",
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR", r.content
    assert state() == before


def test_refund_needs_an_idempotency_key(barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    r = barista_c.post(
        f"/api/v1/orders/{oid}/refunds", {"reason": "abc", "confirm_amount": "65.00"}, format="json"
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"


def test_the_cash_leaves_the_refunding_users_shift_not_the_sellers(org, barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    b2c = client_for(make_user(org, "barista2", "barista"))
    s2 = open_shift(b2c, "50.00")
    assert refund(b2c, oid, "65.00").status_code == 201
    cur2 = data(b2c.get("/api/v1/shifts/current"))["totals"]
    assert cur2["cash_refunds"] == "65.00" and cur2["expected_cash"] == "-15.00"
    cur1 = data(barista_c.get("/api/v1/shifts/current"))["totals"]
    assert cur1["cash_sales"] == "65.00" and cur1["cash_refunds"] == "0.00"
    assert cur1["expected_cash"] == "165.00"
    assert str(Refund.objects.get().shift_id) == s2["id"]


def test_a_closed_shift_keeps_its_numbers_after_a_later_refund(
    org, barista_c, shop, shift, admin_c
):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    assert close_shift(barista_c, shift["id"], "165.00").status_code == 200
    open_shift(admin_c)
    assert refund(admin_c, oid, "65.00").status_code == 201
    s = data(admin_c.get(f"/api/v1/shifts/{shift['id']}"))
    assert s["expected_cash"] == "165.00" and s["totals"]["cash_refunds"] == "0.00"


def test_refund_of_another_organizations_order_is_404(org, admin2_c, barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    open_shift(admin2_c)
    r = refund(admin2_c, oid, "65.00")
    assert r.status_code == 404 and Order.objects.get().status == "paid"


def test_unknown_order_is_404(barista_c, shift):
    assert refund(barista_c, uuid.uuid4(), "1.00").status_code == 404


def test_zero_total_order_can_be_refunded_with_no_lines(barista_c, shop, shift):
    from apps.catalog.models import ProductVariant

    ProductVariant.objects.filter(pk=shop.small.pk).update(price="0.00")
    oid = sell(barista_c, shop, [], "0.00")
    r = refund(barista_c, oid, "0.00")
    assert r.status_code == 201 and data(r)["lines"] == []


@pytest.mark.django_db(transaction=True)
def test_two_racing_refunds_with_different_keys_make_exactly_one(org, barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    cashier = make_user(org, "racer", "barista")
    open_shift(client_for(cashier))
    start, codes = threading.Barrier(2), []

    def go(user):
        try:
            c = client_for(user)
            start.wait()
            codes.append(refund(c, oid, "65.00").status_code)
        finally:
            connection.close()

    from apps.accounts.models import User

    users = [User.objects.get(username="barista"), cashier]
    ts = [threading.Thread(target=go, args=(u,)) for u in users]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [201, 409]
    assert Refund.objects.count() == 1 and RefundLine.objects.count() == 1


def test_refund_ledger_filters_and_is_admin_only(org, barista_c, shop, shift, admin_c):
    o1 = sell(barista_c, shop, [cash("65.00")], "65.00")
    o2 = sell(barista_c, shop, [card("65.00")], "65.00")
    refund(barista_c, o1, "65.00")
    refund(barista_c, o2, "65.00")
    rows = admin_c.get("/api/v1/refunds").json()
    assert rows["meta"]["total_count"] == 2
    assert admin_c.get("/api/v1/refunds?method=card").json()["meta"]["total_count"] == 1
    assert (
        admin_c.get("/api/v1/refunds?actor_id=" + str(uuid.uuid4())).json()["meta"]["total_count"]
        == 0
    )
    row = rows["data"][0]
    assert {"invoice_no", "reason", "actor", "original_cashier", "lines"} <= set(row)
    assert barista_c.get("/api/v1/refunds").status_code == 403
    pay = admin_c.get("/api/v1/payments").json()
    assert pay["meta"]["total_count"] == 2 and {"order_status", "invoice_no"} <= set(pay["data"][0])
    assert admin_c.get("/api/v1/payments?method=cash").json()["meta"]["total_count"] == 1
    assert (
        admin_c.get("/api/v1/payments?from=2000-01-01&to=2000-01-02").json()["meta"]["total_count"]
        == 0
    )
    assert admin_c.get("/api/v1/payments?from=bad").status_code == 400
    assert barista_c.get("/api/v1/payments").status_code == 403


def test_ledgers_are_tenant_scoped(admin2_c, barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    refund(barista_c, oid, "65.00")
    assert admin2_c.get("/api/v1/refunds").json()["meta"]["total_count"] == 0
    assert admin2_c.get("/api/v1/payments").json()["meta"]["total_count"] == 0


def test_closed_shift_cannot_take_a_refund(barista_c, shop, shift):
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")
    assert close_shift(barista_c, shift["id"], "165.00").status_code == 200
    r = refund(barista_c, oid, "65.00")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    assert CashierShift.objects.get().status == "closed"


def test_the_same_key_on_another_order_is_409_idempotency_conflict(barista_c, shop, shift):
    o1 = sell(barista_c, shop, [cash("65.00")], "65.00")
    o2 = sell(barista_c, shop, [cash("65.00")], "65.00")
    key = uuid.uuid4()
    assert refund(barista_c, o1, "65.00", key=key).status_code == 201
    r = refund(barista_c, o2, "65.00", key=key)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert Refund.objects.count() == 1 and Order.objects.get(pk=o2).status == "paid"
