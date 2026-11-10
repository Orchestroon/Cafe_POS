import threading
import uuid
from decimal import Decimal

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.core.models import IdempotencyRecord
from apps.inventory.models import StockMovement
from apps.sales.models import InvoiceCounter, Order, OrderItem, Payment
from apps.tenancy.models import OrganizationSettings
from conftest import client_for, data, make_user

from .conftest import balance, card, cash, checkout, item, open_shift

pytestmark = pytest.mark.django_db


@pytest.fixture
def shift(barista_c):
    return open_shift(barista_c)


def state():
    return (
        Order.objects.count(),
        OrderItem.objects.count(),
        Payment.objects.count(),
        StockMovement.objects.filter(movement_type="sale").count(),
        AuditEvent.objects.filter(action="order.created").count(),
        IdempotencyRecord.objects.filter(scope="checkout").count(),
        InvoiceCounter.objects.get().last_number if InvoiceCounter.objects.exists() else 0,
    )


def test_at07_cash_only_with_change(barista_c, shop, shift):
    r = checkout(barista_c, [item(shop.small, 2)], [cash("130.00", "200.00")], "130.00")
    assert r.status_code == 201, r.content
    d = data(r)
    assert d["invoice_no"] == "POS-0000001" and d["status"] == "paid" and d["total"] == "130.00"
    assert d["change_due"] == "70.00"
    assert d["payments"] == [
        {"method": "cash", "amount": "130.00", "cash_tendered": "200.00", "change_given": "70.00"}
    ]
    assert d["receipt_url"] == f"/api/v1/orders/{d['order_id']}/receipt"
    assert d["stock_warnings"] == []
    order = Order.objects.get()
    assert order.shift_id == uuid.UUID(shift["id"]) and order.cashier.username == "barista"
    assert Payment.objects.get().method == "cash"
    assert AuditEvent.objects.filter(action="order.created").count() == 1


def test_cash_without_tendered_defaults_to_amount(barista_c, shop, shift):
    d = data(checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00"))
    assert d["change_due"] == "0.00"
    assert d["payments"][0]["cash_tendered"] == "65.00"


def test_at08_card_only_with_reference(barista_c, shop, shift):
    d = data(checkout(barista_c, [item(shop.small)], [card("65.00", "term-1")], "65.00"))
    assert d["payments"] == [{"method": "card", "amount": "65.00", "external_reference": "term-1"}]
    assert d["change_due"] == "0.00"
    assert Payment.objects.get().external_reference == "term-1"


def test_at09_mixed_80_cash_120_card(barista_c, shop, shift):
    items = [item(shop.large, 2, [shop.oat])]  # 2 x (80 + 20) = 200
    d = data(checkout(barista_c, items, [cash("80.00", "100.00"), card("120.00", "t-9")], "200.00"))
    assert d["total"] == "200.00" and d["change_due"] == "20.00"
    pays = {p.method: p.amount for p in Payment.objects.all()}
    assert pays == {"cash": Decimal("80.00"), "card": Decimal("120.00")}
    assert sum(pays.values()) == Order.objects.get().total


def test_stock_is_deducted_per_recipe_and_ledger_is_written(barista_c, shop, shift):
    checkout(barista_c, [item(shop.small, 2)], [cash("130.00")], "130.00")
    assert balance(shop.ing["Coffee Beans"]) == Decimal("974.800")  # 1000 - 25.2
    assert balance(shop.ing["Whole Milk"]) == Decimal("4600.000")
    assert balance(shop.ing["Cup"]) == Decimal("98.000")
    mv = StockMovement.objects.get(ingredient=shop.ing["Coffee Beans"], movement_type="sale")
    assert mv.qty_delta == Decimal("-25.200") and mv.balance_after == Decimal("974.800")
    assert mv.source_type == "order_item" and mv.created_by.username == "barista"
    assert mv.source_id == OrderItem.objects.get().pk


def test_at04_oat_replaces_milk_nothing_deducted_from_regular(barista_c, shop, shift):
    checkout(barista_c, [item(shop.large, 1, [shop.oat])], [cash("100.00")], "100.00")
    assert balance(shop.ing["Whole Milk"]) == Decimal("5000.000")
    assert balance(shop.ing["Oat Milk"]) == Decimal("750.000")
    assert not StockMovement.objects.filter(
        ingredient=shop.ing["Whole Milk"], movement_type="sale"
    ).exists()


def test_at05_extra_shot_price_and_coffee(barista_c, shop, shift):
    d = data(checkout(barista_c, [item(shop.small, 1, [shop.shot])], [cash("85.00")], "85.00"))
    assert d["total"] == "85.00"
    assert balance(shop.ing["Coffee Beans"]) == Decimal("979.000")  # 1000 - 12.6 - 8.4


def test_at06_shortage_succeeds_with_warning_and_negative_balance(barista_c, shop, shift):
    r = checkout(barista_c, [item(shop.large, 5, [shop.oat])], [cash("500.00")], "500.00")
    assert r.status_code == 201
    w = data(r)["stock_warnings"]
    assert [x["ingredient_name"] for x in w] == ["Oat Milk"]
    assert w[0]["available"] == "1000.000" and w[0]["required"] == "1250.000"
    assert w[0]["projected_balance"] == "-250.000"
    assert balance(shop.ing["Oat Milk"]) == Decimal("-250.000")
    mv = StockMovement.objects.get(ingredient=shop.ing["Oat Milk"], movement_type="sale")
    assert mv.balance_after == Decimal("-250.000")


def test_two_lines_on_the_same_ingredient_chain_balance_after(barista_c, shop, shift):
    checkout(barista_c, [item(shop.small), item(shop.large)], [cash("145.00")], "145.00")
    mvs = list(
        StockMovement.objects.filter(ingredient=shop.ing["Cup"], movement_type="sale").order_by(
            "created_at"
        )
    )
    assert [m.qty_delta for m in mvs] == [Decimal("-1.000"), Decimal("-1.000")]
    assert sorted(m.balance_after for m in mvs) == [Decimal("98.000"), Decimal("99.000")]
    assert balance(shop.ing["Cup"]) == Decimal("98.000")


def test_at10_price_changed_returns_409_and_writes_nothing(barista_c, shop, shift):
    before = state()
    shop.small.price = Decimal("70.00")
    shop.small.save()
    r = checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00")
    assert r.status_code == 409 and r.json()["error"]["code"] == "PRICE_CHANGED"
    det = r.json()["error"]["details"]
    assert det["server_total"] == "70.00" and det["quote"]["total"] == "70.00"
    assert state() == before and balance(shop.ing["Coffee Beans"]) == Decimal("1000.000")
    # reconfirming with the new total (new key) succeeds
    assert checkout(barista_c, [item(shop.small)], [cash("70.00")], "70.00").status_code == 201


def test_at11_same_key_twice_gives_one_order(barista_c, shop, shift):
    key = uuid.uuid4()
    args = ([item(shop.small)], [cash("65.00")], "65.00")
    r1 = checkout(barista_c, *args, key=key)
    r2 = checkout(barista_c, *args, key=key)
    assert r1.status_code == r2.status_code == 201
    assert r2["Idempotent-Replayed"] == "true" and "Idempotent-Replayed" not in r1
    assert r1.json() == r2.json()
    assert Order.objects.count() == 1 and Payment.objects.count() == 1
    assert StockMovement.objects.filter(movement_type="sale").count() == 3
    assert balance(shop.ing["Coffee Beans"]) == Decimal("987.400")  # deducted once


def test_at11_same_key_different_payload_is_409(barista_c, shop, shift):
    key = uuid.uuid4()
    checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00", key=key)
    r = checkout(barista_c, [item(shop.large)], [cash("80.00")], "80.00", key=key)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert Order.objects.count() == 1


@pytest.mark.parametrize("header", [None, "not-a-uuid"])
def test_idempotency_key_is_required(barista_c, shop, shift, header):
    body = {"items": [item(shop.small)], "payments": [cash("65.00")], "expected_total": "65.00"}
    headers = {"Idempotency-Key": header} if header else {}
    r = barista_c.post("/api/v1/orders/checkout", body, format="json", headers=headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
    assert Order.objects.count() == 0


def test_at13_recipe_edit_after_sale_leaves_snapshots_unchanged(admin_c, barista_c, shop, shift):
    checkout(barista_c, [item(shop.small, 1, [shop.shot])], [cash("85.00")], "85.00")
    snap = OrderItem.objects.get()
    before = (
        list(snap.recipe_snapshot),
        list(snap.consumption_snapshot),
        list(snap.modifiers_snapshot),
    )
    r = admin_c.put(
        f"/api/v1/variants/{shop.small.id}/recipe",
        {
            "lines": [
                {
                    "ingredient_id": str(shop.ing["Coffee Beans"].id),
                    "base_qty": "99.000",
                    "waste_pct": "0.00",
                }
            ]
        },
        format="json",
    )
    assert r.status_code == 200
    snap.refresh_from_db()
    assert (snap.recipe_snapshot, snap.consumption_snapshot, snap.modifiers_snapshot) == before
    assert {w["ingredient_name"] for w in snap.recipe_snapshot} == {
        "Coffee Beans",
        "Whole Milk",
        "Cup",
    }
    assert any(w["source"] == "modifier" and "option_id" in w for w in snap.recipe_snapshot)
    assert snap.product_name_snapshot == "Iced Latte" and snap.variant_label_snapshot == "Small"
    assert snap.modifiers_snapshot[0]["option_label"] == "Extra Shot"
    assert snap.consumption_snapshot[0]["total_qty"] == "21.000"


def test_checkout_without_a_shift_is_409_and_writes_nothing(barista_c, shop):
    before = state()
    r = checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    assert state() == before


def test_shift_is_per_user_another_users_shift_does_not_count(admin_c, barista_c, shop):
    open_shift(admin_c)
    r = checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00")
    assert r.json()["error"]["code"] == "SHIFT_NOT_OPEN"


BAD_PAYMENTS = [
    ("empty", [], "INVALID_PAYMENT"),
    ("three", [cash("20.00"), card("20.00"), card("25.00")], "INVALID_PAYMENT"),
    ("dup_method", [cash("30.00"), cash("35.00")], "INVALID_PAYMENT"),
    ("zero_amount", [cash("0.00"), card("65.00")], "INVALID_PAYMENT"),
    ("negative", [cash("-5.00"), card("70.00")], "INVALID_PAYMENT"),
    ("tendered_short", [cash("65.00", "60.00")], "INVALID_PAYMENT"),
    (
        "card_with_tendered",
        [{"method": "card", "amount": "65.00", "cash_tendered": "70.00"}],
        "INVALID_PAYMENT",
    ),
    ("under", [cash("60.00")], "PAYMENT_MISMATCH"),
    ("over", [cash("66.00")], "PAYMENT_MISMATCH"),
    ("split_mismatch", [cash("30.00"), card("30.00")], "PAYMENT_MISMATCH"),
]


@pytest.mark.parametrize(
    ("name", "payments", "code"), BAD_PAYMENTS, ids=[b[0] for b in BAD_PAYMENTS]
)
def test_payment_errors_leave_no_order_and_no_stock_change(
    barista_c, shop, shift, name, payments, code
):
    before = state()
    r = checkout(barista_c, [item(shop.small)], payments, "65.00")
    assert r.status_code == 422 and r.json()["error"]["code"] == code, r.content
    assert state() == before
    assert balance(shop.ing["Coffee Beans"]) == Decimal("1000.000")


def test_payment_number_types_are_rejected_as_validation(barista_c, shop, shift):
    r = checkout(barista_c, [item(shop.small)], [{"method": "cash", "amount": 65}], "65.00")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_failed_checkout_rolls_back_idempotency_record_so_same_key_can_retry(
    barista_c, shop, shift
):
    key = uuid.uuid4()
    bad = checkout(barista_c, [item(shop.small)], [cash("60.00")], "65.00", key=key)
    assert bad.status_code == 422
    assert not IdempotencyRecord.objects.filter(key=key).exists()
    ok = checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00", key=key)
    assert ok.status_code == 201 and "Idempotent-Replayed" not in ok


def test_invoice_numbers_are_gapless_across_a_failed_checkout(barista_c, shop, shift):
    a = data(checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00"))
    fail = checkout(barista_c, [item(shop.small)], [cash("1.00")], "65.00")
    c = data(checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00"))
    assert fail.status_code == 422
    assert (a["invoice_no"], c["invoice_no"]) == ("POS-0000001", "POS-0000002")
    assert sorted(Order.objects.values_list("invoice_seq", flat=True)) == [1, 2]


def test_empty_cart(barista_c, shop, shift):
    r = checkout(barista_c, [], [cash("65.00")], "65.00")
    assert r.status_code == 422 and r.json()["error"]["code"] == "EMPTY_CART"
    assert Order.objects.count() == 0


def test_item_errors_leave_nothing(barista_c, shop, shift):
    before = state()
    for items, code in [
        ([item(shop.small, 0)], "INVALID_QUANTITY"),
        ([item(shop.small, 100)], "INVALID_QUANTITY"),
        ([item(shop.small, 1, [shop.oat, shop.oat])], "MODIFIER_SELECTION_INVALID"),
    ]:
        r = checkout(barista_c, items, [cash("65.00")], "65.00")
        assert r.json()["error"]["code"] == code
    shop.large.is_active = False
    shop.large.save()
    assert (
        checkout(barista_c, [item(shop.large)], [cash("80.00")], "80.00").json()["error"]["code"]
        == "ITEM_UNAVAILABLE"
    )
    assert state() == before


def test_tax_on_top_is_stored_and_must_be_paid(org, barista_c, shop, shift):
    s = OrganizationSettings.objects.get(organization=org)
    s.tax_enabled, s.tax_rate, s.prices_include_tax = True, Decimal("14.00"), False
    s.save()
    r = checkout(barista_c, [item(shop.large, 3)], [cash("240.00")], "240.00")
    assert r.status_code == 409  # client still expects the pre-tax total
    assert r.json()["error"]["details"]["server_total"] == "273.60"
    d = data(checkout(barista_c, [item(shop.large, 3)], [cash("273.60", "300.00")], "273.60"))
    assert (d["subtotal"], d["tax_total"], d["total"], d["change_due"]) == (
        "240.00",
        "33.60",
        "273.60",
        "26.40",
    )
    o = Order.objects.get()
    assert o.tax_snapshot == {"enabled": True, "rate": "14.00", "inclusive": False, "label": "VAT"}


def test_custom_invoice_prefix(org, barista_c, shop, shift):
    OrganizationSettings.objects.filter(organization=org).update(invoice_prefix="CAFE-")
    assert (
        data(checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00"))["invoice_no"]
        == "CAFE-0000001"
    )


def test_orgs_have_independent_invoice_counters(org, org2, shop, barista_c, shift):
    checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00")
    assert InvoiceCounter.objects.get(organization=org).last_number == 1
    assert not InvoiceCounter.objects.filter(organization=org2).exists()  # created lazily


def test_live_shift_totals_reflect_sales(barista_c, shop, shift):
    checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00")
    checkout(barista_c, [item(shop.large, 2, [shop.oat])], [card("200.00")], "200.00")
    t = data(barista_c.get("/api/v1/shifts/current"))["totals"]
    assert (t["cash_sales"], t["card_sales"], t["orders_count"], t["expected_cash"]) == (
        "65.00",
        "200.00",
        2,
        "165.00",
    )


def test_anonymous_cannot_checkout(anon, shop):
    r = checkout(anon, [item(shop.small)], [cash("65.00")], "65.00")
    assert r.status_code == 401


# ---- concurrency (AT-12): real threads, real commits --------------------------------------------


@pytest.mark.django_db(transaction=True)
def test_at12_concurrent_checkouts_leave_the_exact_balance(org, shop):
    users = [make_user(org, f"cashier{i}", "barista") for i in range(5)]
    for u in users:
        open_shift(client_for(u))
    results = []

    def sell(u):
        try:
            r = checkout(client_for(u), [item(shop.small, 2)], [cash("130.00")], "130.00")
            results.append(r.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=sell, args=(u,)) for u in users]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results == [201] * 5
    assert balance(shop.ing["Coffee Beans"]) == Decimal("874.000")  # 1000 - 5 * 25.2
    assert balance(shop.ing["Whole Milk"]) == Decimal("3000.000")
    assert StockMovement.objects.filter(movement_type="sale").count() == 15
    assert sorted(Order.objects.values_list("invoice_seq", flat=True)) == [1, 2, 3, 4, 5]
    last = (
        StockMovement.objects.filter(ingredient=shop.ing["Cup"], movement_type="sale")
        .order_by("balance_after")
        .first()
    )
    assert last.balance_after == Decimal("90.000")


@pytest.mark.django_db(transaction=True)
def test_at11_same_key_sent_concurrently_creates_one_order(org, shop):
    user = make_user(org, "dup", "barista")
    open_shift(client_for(user))
    key = uuid.uuid4()
    out = []

    def go():
        try:
            r = checkout(client_for(user), [item(shop.small)], [cash("65.00")], "65.00", key=key)
            out.append((r.status_code, r.json()))
        finally:
            connection.close()

    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert [s for s, _ in out] == [201] * 4
    assert all(b == out[0][1] for _, b in out)  # identical content (jsonb reorders keys)
    assert Order.objects.count() == 1
    assert balance(shop.ing["Cup"]) == Decimal("99.000")


# ---- audit fixes (2026-11-10) -----------------------------------------------------------------


def test_same_key_from_another_user_is_a_conflict_not_a_replay(org, barista_c, shop, shift):
    """H1: on a shared tablet the next cashier must never replay or finish someone else's sale."""
    key = uuid.uuid4()
    args = ([item(shop.small)], [cash("65.00")], "65.00")
    assert checkout(barista_c, *args, key=key).status_code == 201
    other = client_for(make_user(org, "next_cashier", "barista"))
    open_shift(other)
    r = checkout(other, *args, key=key)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert Order.objects.count() == 1
    assert data(barista_c.get("/api/v1/shifts/current"))["totals"]["orders_count"] == 1


@pytest.fixture
def free_water(org, shop):
    from apps.catalog.models import ProductVariant

    return ProductVariant.objects.create(
        organization=org, product=shop.small.product, label="Water", price="0.00", sort_order=9
    )


def test_zero_total_order_needs_no_payment(barista_c, shop, shift, free_water):
    """M4 (owner decision 2026-11-10): a 0.00 order is sold with no payment rows."""
    r = checkout(barista_c, [item(free_water)], [], "0.00")
    assert r.status_code == 201, r.content
    d = data(r)
    assert (d["total"], d["payments"], d["change_due"]) == ("0.00", [], "0.00")
    assert Payment.objects.count() == 0 and Order.objects.get().total == Decimal("0.00")


def test_zero_total_order_rejects_a_payment(barista_c, shop, shift, free_water):
    before = state()
    r = checkout(barista_c, [item(free_water)], [cash("1.00")], "0.00")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_PAYMENT"
    assert state() == before
