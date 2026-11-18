"""Promotions through quote and checkout: server-side re-validation, snapshots, and the proof that
stock and cost do not depend on the discount (spec 8.12, 8.2, 8.13)."""

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.audit.models import AuditEvent
from apps.inventory.models import StockMovement
from apps.promotions.models import ComboSlot, Promotion
from apps.sales.models import Order, OrderPromotion
from apps.tenancy.models import OrganizationSettings
from conftest import data

from .conftest import cash, checkout, item, open_shift

pytestmark = pytest.mark.django_db


@pytest.fixture
def shift(barista_c):
    return open_shift(barista_c)


def make_promo(org, shop=None, **kw):
    kw.setdefault("kind", "discount")
    kw.setdefault("name", f"P-{uuid.uuid4().hex[:6]}")
    kw.setdefault("scope", "order")
    kw.setdefault("discount_type", "percentage")
    kw.setdefault("discount_value", "10.00")
    variants = kw.pop("variants", ())
    p = Promotion.objects.create(organization=org, **kw)
    p.variants.set(variants)
    return p


def make_combo(org, shop, price="100.00", **kw):
    p = Promotion.objects.create(
        organization=org, kind="combo", name="Duo", combo_price=price, **kw
    )
    s = ComboSlot.objects.create(organization=org, promotion=p, quantity=2)
    s.variants.set([shop.small, shop.large])
    return p


def quote(c, items, **extra):
    return c.post("/api/v1/orders/quote", {"items": items, **extra}, format="json")


def test_quote_shows_the_promotion_line_by_line(barista_c, org, shop):
    make_promo(org, name="Ten off", variants=[shop.small], scope="variant", discount_value="10.00")
    q = data(quote(barista_c, [item(shop.small, 2), item(shop.large)]))
    assert q["subtotal"] == "210.00" and q["discount_total"] == "13.00" and q["total"] == "197.00"
    assert q["promotions"] == [
        {
            "id": q["promotions"][0]["id"],
            "name": "Ten off",
            "kind": "discount",
            "amount": "13.00",
            "manual": False,
        }
    ]
    first, second = q["items"]
    assert (first["line_subtotal"], first["line_discount"], first["line_total"]) == (
        "130.00",
        "13.00",
        "117.00",
    )
    assert first["unit_discount"] == "6.50" and first["promotions"][0]["name"] == "Ten off"
    assert second["line_discount"] == "0.00" and second["promotions"] == []


def test_checkout_applies_it_and_stores_what_was_applied(barista_c, org, shop, shift):
    p = make_promo(org, name="Ten off", variants=[shop.small], scope="variant")
    r = checkout(barista_c, [item(shop.small, 2)], [cash("117.00")], "117.00")
    assert r.status_code == 201, r.content
    body = data(r)
    assert body["discount_total"] == "13.00" and body["total"] == "117.00"
    assert body["promotions"][0]["name"] == "Ten off"
    order = Order.objects.get()
    op = OrderPromotion.objects.get()
    assert (op.order_id, op.promotion_id, op.amount, op.name_snapshot) == (
        order.pk,
        p.pk,
        Decimal("13.00"),
        "Ten off",
    )
    line = order.items.get()
    assert (
        line.line_discount == Decimal("13.00") and line.promotion_snapshot[0]["amount"] == "13.00"
    )
    audit = AuditEvent.objects.get(action="order.created").summary
    assert audit["discount_total"] == "13.00" and audit["promotions"][0]["name"] == "Ten off"


def test_the_total_is_always_the_servers_a_stale_or_tampered_total_is_refused(
    barista_c, org, shop, shift
):
    make_promo(org, variants=[shop.small], scope="variant")
    r = checkout(
        barista_c, [item(shop.small, 2)], [cash("130.00")], "130.00"
    )  # pretends no discount
    assert r.status_code == 409 and r.json()["error"]["code"] == "PRICE_CHANGED"
    assert r.json()["error"]["details"]["server_total"] == "117.00"
    assert Order.objects.count() == 0
    r = checkout(
        barista_c, [item(shop.small, 2)], [cash("100.00")], "100.00"
    )  # asks for more discount
    assert r.status_code == 409
    for field in ("discount_total", "unit_discount", "discount"):
        r = checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50", **{field: "99.00"})
        assert r.status_code == 400  # a client can not send a discount at all


def test_a_promotion_switched_off_between_quote_and_pay_changes_the_price(
    barista_c, org, shop, shift
):
    p = make_promo(org, variants=[shop.small], scope="variant")
    total = data(quote(barista_c, [item(shop.small)]))["total"]
    p.is_active = False
    p.save()
    r = checkout(barista_c, [item(shop.small)], [cash(total)], total)
    assert r.status_code == 409 and r.json()["error"]["details"]["server_total"] == "65.00"


def test_a_happy_hour_applies_only_inside_its_window_and_days(barista_c, org, shop, shift):
    tz = OrganizationSettings.objects.get(organization=org).timezone
    from zoneinfo import ZoneInfo

    now = timezone.now().astimezone(ZoneInfo(tz))
    inside = dict(
        window_start=(now - timedelta(hours=1)).time(), window_end=(now + timedelta(hours=1)).time()
    )
    outside = dict(
        window_start=(now + timedelta(hours=3)).time(), window_end=(now + timedelta(hours=4)).time()
    )
    p = make_promo(org, variants=[shop.small], scope="variant", **outside)
    assert data(quote(barista_c, [item(shop.small)]))["discount_total"] == "0.00"
    Promotion.objects.filter(pk=p.pk).update(**inside)
    assert data(quote(barista_c, [item(shop.small)]))["discount_total"] == "6.50"
    Promotion.objects.filter(pk=p.pk).update(days_of_week=[(now.weekday() + 1) % 7])
    assert data(quote(barista_c, [item(shop.small)]))["discount_total"] == "0.00"
    Promotion.objects.filter(pk=p.pk).update(
        days_of_week=[now.weekday()], ends_on=now.date() - timedelta(days=1)
    )
    assert data(quote(barista_c, [item(shop.small)]))["discount_total"] == "0.00"


def test_inactive_and_other_cafe_promotions_never_apply(barista_c, org, org2, shop):
    make_promo(org, is_active=False)
    make_promo(org2)
    assert data(quote(barista_c, [item(shop.small)]))["discount_total"] == "0.00"


def test_retrying_with_the_same_key_applies_it_once(barista_c, org, shop, shift):
    make_promo(org)
    key = uuid.uuid4()
    a = checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50", key=key)
    b = checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50", key=key)
    assert a.status_code == 201 and b.status_code == 201 and data(a) == data(b)
    assert Order.objects.count() == 1 and OrderPromotion.objects.count() == 1


def test_manual_promotion_needs_to_be_tapped_and_unknown_ids_are_ignored(
    barista_c, org, shop, shift
):
    p = make_promo(org, name="Coupon", auto_apply=False)
    q = data(quote(barista_c, [item(shop.small)]))
    assert q["discount_total"] == "0.00" and q["selectable"][0]["name"] == "Coupon"
    assert q["selectable"][0]["gain"] == "6.50" and q["selectable"][0]["selected"] is False
    q = data(quote(barista_c, [item(shop.small)], promotion_ids=[str(p.pk), str(uuid.uuid4())]))
    assert q["discount_total"] == "6.50" and q["promotions"][0]["manual"] is True
    r = checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50", promotion_ids=[str(p.pk)])
    assert r.status_code == 201 and OrderPromotion.objects.get().manual is True
    assert (
        data(barista_c.get(f"/api/v1/orders/{data(r)['order_id']}"))["promotions"][0]["name"]
        == "Coupon"
    )


def test_a_combo_through_checkout(barista_c, org, shop, shift):
    make_combo(org, shop, "100.00")
    q = data(quote(barista_c, [item(shop.small), item(shop.large)]))  # 65 + 80 = 145
    assert q["discount_total"] == "45.00" and q["total"] == "100.00"
    assert sum(Decimal(i["line_discount"]) for i in q["items"]) == Decimal("45.00")
    assert (
        checkout(
            barista_c, [item(shop.small), item(shop.large)], [cash("100.00")], "100.00"
        ).status_code
        == 201
    )


def strip(rows):
    return [(r.ingredient_id, r.qty_delta, r.unit_cost, r.balance_after) for r in rows]


def test_stock_and_cost_are_the_same_with_or_without_a_promotion(barista_c, org, shop, shift):
    """The core promise: a discount (even a combo) changes the price, never what is consumed or
    what it cost at the weighted average."""
    items = [item(shop.small, 1, [shop.shot]), item(shop.large, 2, [shop.oat])]
    plain = data(quote(barista_c, items))
    checkout(barista_c, items, [cash(plain["total"])], plain["total"])
    first = Order.objects.get()

    make_combo(org, shop, "100.00")
    make_promo(org, name="Order", discount_value="50.00")
    with_promos = data(quote(barista_c, items))
    assert with_promos["discount_total"] != "0.00"
    checkout(barista_c, items, [cash(with_promos["total"])], with_promos["total"])
    second = Order.objects.exclude(pk=first.pk).get()

    def moves(order):
        rows = StockMovement.objects.filter(source_id__in=[i.pk for i in order.items.all()])
        return sorted((str(m.ingredient_id), m.qty_delta, m.unit_cost) for m in rows)

    assert moves(first) and moves(first) == moves(
        second
    )  # same ingredients, quantities, unit costs
    assert first.cost_total is not None and first.cost_total == second.cost_total
    for a, b in zip(first.items.all(), second.items.all(), strict=True):
        assert a.consumption_snapshot == b.consumption_snapshot and a.cost_total == b.cost_total
    assert second.subtotal == first.subtotal and second.total < first.total


def test_profit_is_after_the_discount_and_reports_split_gross_discount_net(
    admin_c, barista_c, org, shop, shift
):
    make_promo(org, name="Ten", discount_value="10.00")
    items = [item(shop.small, 2)]  # 130.00 - 13.00 = 117.00
    checkout(barista_c, items, [cash("117.00")], "117.00")
    cost = Order.objects.get().cost_total
    s = data(admin_c.get("/api/v1/reports/sales-summary"))
    assert (s["gross_sales"], s["discounts"], s["collected"]) == ("130.00", "13.00", "117.00")
    p = data(admin_c.get("/api/v1/reports/profit"))
    assert (p["sales_before_discounts"], p["promotion_discounts"], p["sales"]) == (
        "130.00",
        "13.00",
        "117.00",
    )
    assert Decimal(p["gross_profit"]) == Decimal("117.00") - cost
    r = data(admin_c.get("/api/v1/reports/promotions"))
    assert (
        r["discount_total"] == "13.00"
        and r["orders_with_promotion"] == 1
        and r["orders_count"] == 1
    )
    assert r["promotions"] == [
        {
            "promotion_id": r["promotions"][0]["promotion_id"],
            "name": "Ten",
            "kind": "discount",
            "orders_count": 1,
            "manual_count": 0,
            "discount_total": "13.00",
        }
    ]


def test_the_profit_split_holds_when_prices_include_tax(admin_c, barista_c, org, shop, shift):
    OrganizationSettings.objects.filter(organization=org).update(
        tax_enabled=True, tax_rate="14.00", prices_include_tax=True
    )
    make_promo(org, discount_value="20.00")
    checkout(
        barista_c, [item(shop.small, 2)], [cash("104.00")], "104.00"
    )  # 130 - 26 = 104 incl. tax
    p = data(admin_c.get("/api/v1/reports/profit"))
    assert Decimal(p["sales_before_discounts"]) - Decimal(p["promotion_discounts"]) == Decimal(
        p["sales"]
    )


def test_the_promotions_report_is_admin_only_and_keeps_names_after_an_edit(
    admin_c, barista_c, org, shop, shift
):
    p = make_promo(org, name="Old name")
    checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50")
    p.name = "New name"
    p.save()
    assert barista_c.get("/api/v1/reports/promotions").status_code == 403
    assert data(admin_c.get("/api/v1/reports/promotions"))["promotions"][0]["name"] == "Old name"


def test_a_refund_returns_what_was_paid_and_the_discount_stays_recorded(
    admin_c, barista_c, org, shop, shift
):
    make_promo(org)
    d = data(checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50"))
    r = barista_c.post(
        f"/api/v1/orders/{d['order_id']}/refunds",
        {"reason": "customer changed mind", "confirm_amount": "58.50"},
        format="json",
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code == 201, r.content
    s = data(admin_c.get("/api/v1/reports/sales-summary"))
    assert (s["discounts"], s["refunds"], s["net_sales"]) == ("6.50", "58.50", "0.00")


def test_order_detail_and_receipt_show_the_discount_breakdown(barista_c, org, shop, shift):
    p = make_promo(org, name="Ten off", variants=[shop.small], scope="variant")
    oid = data(checkout(barista_c, [item(shop.small, 2)], [cash("117.00")], "117.00"))["order_id"]
    p.name, p.discount_value = "Renamed", "50.00"  # later edits never touch past orders
    p.save()
    detail = data(barista_c.get(f"/api/v1/orders/{oid}"))
    line = detail["items"][0]
    assert (line["line_subtotal"], line["line_discount"], line["line_total"]) == (
        "130.00",
        "13.00",
        "117.00",
    )
    assert (
        line["promotions"][0]["name"] == "Ten off" and detail["promotions"][0]["amount"] == "13.00"
    )
    rc = data(barista_c.get(f"/api/v1/orders/{oid}/receipt"))
    assert (
        rc["items"][0]["promotions"] == ["Ten off"] and rc["items"][0]["line_discount"] == "13.00"
    )
    assert rc["promotions"] == [{"promotion_id": str(p.pk), "name": "Ten off", "amount": "13.00"}]
    assert rc["discount_total"] == "13.00" and rc["total"] == "117.00"


def test_a_promotion_that_was_used_can_not_be_deleted(barista_c, org, shop, shift):
    p = make_promo(org)
    checkout(barista_c, [item(shop.small)], [cash("58.50")], "58.50")
    from django.db.models import ProtectedError

    with pytest.raises(ProtectedError):
        p.delete()


def test_a_free_order_takes_no_payment(barista_c, org, shop, shift):
    make_promo(org, discount_value="100.00")
    r = checkout(barista_c, [item(shop.small)], [], "0.00")
    assert r.status_code == 201 and data(r)["total"] == "0.00"
    assert StockMovement.objects.filter(movement_type="sale").exists()  # the drink was still made


def test_variant_costs_feed_the_below_cost_warning_and_stay_admin_only(admin_c, barista_c, shop):
    rows = {r["variant_label"]: r for r in data(admin_c.get("/api/v1/promotions/variant-costs"))}
    # Small: 12 g x 1.05 waste x 1.00 + 200 ml x 0.05 + 1 cup x 1.00
    assert rows["Small"]["cost"] == "23.60" and rows["Small"]["price"] == "65.00"
    assert rows["Large"]["cost"] == "34.90"
    assert barista_c.get("/api/v1/promotions/variant-costs").status_code == 403


def test_quote_query_count_does_not_grow_with_the_cart_or_the_promotions(barista_c, org, shop):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    for i in range(3):
        make_promo(org, name=f"v{i}", variants=[shop.small, shop.large], scope="variant")
    make_combo(org, shop)
    make_promo(org, name="coupon", auto_apply=False)

    def n(items):
        with CaptureQueriesContext(connection) as q:
            assert quote(barista_c, items).status_code == 200
        return len(q)

    one = n([item(shop.small, 1, [shop.oat])])
    many = n([item(shop.small, 2), item(shop.large, 3, [shop.oat, shop.shot])])
    assert one == many <= 22
