"""Sprint 5 P4 (owner, 2026-11-17): buying on credit with partial supplier payments. A credit
purchase adds its stock and cost when posted, but no money goes out; each supplier payment is
one expense on the day it is paid (from the drawer: the payer's open shift)."""

import threading
import uuid
from decimal import Decimal

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.expenses.models import Expense
from apps.inventory.models import StockBalance
from apps.purchasing.models import Purchase, Supplier, SupplierPayment
from apps.sales.tests.conftest import close_shift, open_shift
from conftest import client_for, data

pytestmark = pytest.mark.django_db
D = Decimal


def key():
    return {"Idempotency-Key": str(uuid.uuid4())}


@pytest.fixture
def dairy(org):
    return Supplier.objects.create(organization=org, name="Dairy Co")


def credit_purchase(c, shop, supplier, total="300.00", post=True, **over):
    body = {
        "purchased_on": "2026-11-17",
        "supplier_id": str(supplier.pk) if supplier else None,
        "on_credit": True,
        "items": [
            {"ingredient_id": str(shop.ing["Whole Milk"].pk), "qty": "10000", "line_total": total}
        ],
        **over,
    }
    r = c.post("/api/v1/purchases", body, format="json")
    assert r.status_code == 201, r.content
    pid = data(r)["id"]
    if post:
        r = c.post(f"/api/v1/purchases/{pid}/post", {}, format="json", headers=key())
        assert r.status_code == 200, r.content
    return pid


def pay(c, supplier, lines, source="external", method="transfer", k=None):
    body = {
        "supplier_id": str(supplier.pk),
        "source": source,
        "payment_method": method,
        "lines": [{"purchase_id": pid, "amount": amount} for pid, amount in lines],
    }
    return c.post(
        "/api/v1/supplier-payments",
        body,
        format="json",
        headers={"Idempotency-Key": k or str(uuid.uuid4())},
    )


def owed(c, supplier):
    rows = data(c.get("/api/v1/suppliers"))
    return next(s["owed"] for s in rows if s["id"] == str(supplier.pk))


def test_credit_purchase_adds_stock_and_cost_but_no_money_out(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    p = data(admin_c.get(f"/api/v1/purchases/{pid}"))
    assert p["on_credit"] is True and p["owed"] == "300.00" and p["amount_paid"] == "0.00"
    bal = StockBalance.objects.get(ingredient=shop.ing["Whole Milk"])
    assert bal.qty == D("15000") and bal.avg_cost == D("0.036667")  # (250 + 300) / 15000
    assert not Expense.objects.exists()
    assert owed(admin_c, dairy) == "300.00"
    owing = admin_c.get("/api/v1/purchases", {"owed": "true"}).json()["data"]
    assert [x["id"] for x in owing] == [pid]


def test_credit_needs_a_supplier(admin_c, shop):
    pid = credit_purchase(admin_c, shop, None, post=False)
    r = admin_c.post(f"/api/v1/purchases/{pid}/post", {}, format="json", headers=key())
    assert r.status_code == 400 and "supplier_id" in r.json()["error"]["details"]["fields"]
    assert Purchase.objects.get(pk=pid).status == "draft"


def test_partial_payments_until_paid_off(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    r = pay(admin_c, dairy, [(pid, "100.00")])
    assert r.status_code == 201, r.content
    body = data(r)
    assert body["amount"] == "100.00" and body["lines"][0]["amount"] == "100.00"
    assert owed(admin_c, dairy) == "200.00"
    exp = Expense.objects.get(supplier_payment_id=body["id"])
    assert (exp.type, exp.amount, exp.source, exp.payment_method) == (
        "supplier_payment",
        D("100"),
        "external",
        "transfer",
    )
    over = pay(admin_c, dairy, [(pid, "200.01")])
    assert over.status_code == 422 and over.json()["error"]["code"] == "PAYMENT_EXCEEDS_OWED"
    assert pay(admin_c, dairy, [(pid, "200.00")]).status_code == 201
    assert owed(admin_c, dairy) == "0.00" and Purchase.objects.get(pk=pid).amount_paid == D("300")
    assert admin_c.get("/api/v1/purchases", {"owed": "true"}).json()["data"] == []
    assert AuditEvent.objects.filter(action="supplier_payment.created").count() == 2


def test_one_payment_can_pay_several_purchases_of_the_same_supplier(admin_c, shop, dairy, org):
    a = credit_purchase(admin_c, shop, dairy, "300.00")
    b = credit_purchase(admin_c, shop, dairy, "50.00")
    r = pay(admin_c, dairy, [(a, "120.00"), (b, "50.00")])
    assert r.status_code == 201 and data(r)["amount"] == "170.00"
    assert owed(admin_c, dairy) == "180.00"
    other = Supplier.objects.create(organization=org, name="Beans Co")
    c = credit_purchase(admin_c, shop, other, "10.00")
    r = pay(admin_c, dairy, [(c, "5.00")])  # not this supplier's purchase
    assert r.status_code == 400 and SupplierPayment.objects.count() == 1


@pytest.mark.parametrize(
    "lines",
    [[], [("{pid}", "0.00")], [("{pid}", "-1.00")], [("{pid}", "1.00"), ("{pid}", "1.00")]],
)
def test_payment_validation(admin_c, shop, dairy, lines):
    pid = credit_purchase(admin_c, shop, dairy)
    r = pay(admin_c, dairy, [(p.format(pid=pid), a) for p, a in lines])
    assert r.status_code == 400 and not SupplierPayment.objects.exists()


def test_only_posted_credit_purchases_can_be_paid(admin_c, shop, dairy):
    draft = credit_purchase(admin_c, shop, dairy, post=False)
    r = pay(admin_c, dairy, [(draft, "1.00")])
    assert r.status_code == 422 and r.json()["error"]["details"]["why"] == "not_on_credit"
    paid_now = credit_purchase(admin_c, shop, dairy, on_credit=False)
    r = pay(admin_c, dairy, [(paid_now, "1.00")])
    assert r.status_code == 422 and not SupplierPayment.objects.exists()


def test_drawer_payment_lowers_expected_cash_and_needs_an_open_shift(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    r = pay(admin_c, dairy, [(pid, "50.00")], source="cash_drawer", method="cash")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    r = pay(admin_c, dairy, [(pid, "50.00")], source="cash_drawer", method="card")
    assert r.status_code == 400
    s = open_shift(admin_c, "500.00")
    assert pay(admin_c, dairy, [(pid, "50.00")], "cash_drawer", "cash").status_code == 201
    assert data(admin_c.get("/api/v1/shifts/current"))["totals"]["expected_cash"] == "450.00"
    assert close_shift(admin_c, s["id"], "450.00").status_code == 200
    # a drawer payment of a closed shift is frozen
    pay_id = SupplierPayment.objects.get().pk
    r = admin_c.post(f"/api/v1/supplier-payments/{pay_id}/void", {"reason": "x"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["details"]["why"] == "shift_closed"


def test_void_payment_makes_it_owed_again(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    pay_id = data(pay(admin_c, dairy, [(pid, "100.00")]))["id"]
    url = f"/api/v1/supplier-payments/{pay_id}/void"
    assert admin_c.post(url, {"reason": " "}, format="json").status_code == 400
    r = admin_c.post(url, {"reason": "Wrong amount"}, format="json")
    assert r.status_code == 200 and data(r)["status"] == "voided"
    assert owed(admin_c, dairy) == "300.00"
    assert Expense.objects.get(supplier_payment_id=pay_id).status == "voided"
    assert admin_c.post(url, {"reason": "again"}, format="json").status_code == 409
    # its expense is voided with the payment, never on its own
    exp = Expense.objects.get(supplier_payment_id=pay_id)
    r = admin_c.post(f"/api/v1/expenses/{exp.pk}/void", {"reason": "Mistake"}, format="json")
    assert r.status_code == 422


def test_a_purchase_with_payments_cannot_be_voided(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    pay_id = data(pay(admin_c, dairy, [(pid, "10.00")]))["id"]
    r = admin_c.post(f"/api/v1/purchases/{pid}/void", {"reason": "x"}, format="json")
    assert r.status_code == 409 and r.json()["error"]["details"]["why"] == "has_payments"
    admin_c.post(f"/api/v1/supplier-payments/{pay_id}/void", {"reason": "x"}, format="json")
    r = admin_c.post(f"/api/v1/purchases/{pid}/void", {"reason": "Returned"}, format="json")
    assert r.status_code == 200
    assert owed(admin_c, dairy) == "0.00"  # a voided purchase is not owed


def test_same_key_replays_the_payment(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    k = str(uuid.uuid4())
    first = pay(admin_c, dairy, [(pid, "100.00")], k=k)
    again = pay(admin_c, dairy, [(pid, "100.00")], k=k)
    assert first.status_code == again.status_code == 201
    assert data(first)["id"] == data(again)["id"] and SupplierPayment.objects.count() == 1
    assert pay(admin_c, dairy, [(pid, "50.00")], k=k).status_code == 409  # other payload
    assert owed(admin_c, dairy) == "200.00"


def test_payments_list_and_money_report(admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    pay(admin_c, dairy, [(pid, "100.00")])
    rows = admin_c.get("/api/v1/supplier-payments", {"supplier_id": str(dairy.pk)}).json()
    assert rows["meta"]["total_count"] == 1 and rows["data"][0]["supplier"]["name"] == "Dairy Co"
    m = admin_c.get("/api/v1/reports/money-in-out").json()["data"]
    got = {r["key"]: r for r in m["rows"]}
    assert got["other_supplier_payments"]["transfer"] == "100.00"
    assert got["other_purchases"]["total"] == "0.00"  # the credit post moved no money
    pe = admin_c.get("/api/v1/reports/purchases-expenses").json()["data"]
    assert pe["purchase_total"] == "100.00"
    p = admin_c.get("/api/v1/reports/profit").json()["data"]
    assert p["purchases_info"] == "300.00"  # stock bought, paid or not
    assert p["general_expenses"] == "0.00"  # paying a supplier is not a cost: the stock is


def test_barista_cannot_see_or_pay_suppliers(barista_c, admin_c, shop, dairy):
    pid = credit_purchase(admin_c, shop, dairy)
    assert barista_c.get("/api/v1/supplier-payments").status_code == 403
    assert pay(barista_c, dairy, [(pid, "1.00")]).status_code == 403
    assert not SupplierPayment.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_racing_payments_never_pay_more_than_owed(org, admin, shop):
    dairy = Supplier.objects.create(organization=org, name="Dairy Co")
    c0 = client_for(admin)
    pid = credit_purchase(c0, shop, dairy, "100.00")
    codes, barrier = [], threading.Barrier(2)

    def work():
        try:
            c = client_for(admin)
            barrier.wait()
            codes.append(pay(c, dairy, [(pid, "60.00")]).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=work) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(codes) == [201, 422]
    assert Purchase.objects.get(pk=pid).amount_paid == D("60")
