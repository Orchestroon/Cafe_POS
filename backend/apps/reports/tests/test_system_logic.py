"""Checks of docs/SYSTEM_LOGIC.md that no other test covers (owner, 2026-11-17: "check that the
system really does what the logic says"): the stock value equation, profit with tax, and a refund
made on a later day than its sale."""

from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.inventory.models import StockBalance
from apps.inventory.services import unit_cost
from apps.sales.models import Order, Refund
from apps.sales.selectors import org_timezone
from apps.sales.tests.conftest import cash, checkout, item, open_shift, refund, sell
from apps.tenancy.models import OrganizationSettings
from conftest import data

from .test_money_review import buy, report, set_cost

pytestmark = pytest.mark.django_db

COSTED = ("Coffee Beans", "Whole Milk", "Cup")


@pytest.fixture
def priced(shop):
    set_cost(shop.ing["Whole Milk"], "0.03")
    set_cost(shop.ing["Cup"], "1.5")
    return shop


def stock_value(shop):
    total = Decimal("0")
    for name in COSTED:
        b = StockBalance.objects.select_related("ingredient").get(ingredient=shop.ing[name])
        total += b.qty * unit_cost(b)
    return total


def test_stock_value_equation_every_pound_of_stock(admin_c, barista_c, priced):
    """Section 4 + 9: value at the start + purchases - cost of what was sold - losses + stock
    added by counts (not profit) = value at the end. Only rounding of each order's cost to the
    piastre may differ."""
    buy(admin_c, priced.ing["Coffee Beans"], "1", "1000", "400.00")  # coffee now has a cost
    start = stock_value(priced)

    buy(admin_c, priced.ing["Coffee Beans"], "1", "1000", "460.00")
    buy(admin_c, priced.ing["Cup"], "1", "100", "200.00")  # 2.00 each: the cup average moves
    open_shift(barista_c)
    a = sell(barista_c, priced, [cash("65.00")], "65.00", qty=1)
    sell(barista_c, priced, [cash("130.00")], "130.00", qty=2)
    sell(barista_c, priced, [cash("160.00")], "160.00", qty=2, variant=priced.large)
    assert refund(barista_c, a, "65.00").status_code == 201  # stock not back, cost kept
    milk = StockBalance.objects.get(ingredient=priced.ing["Whole Milk"]).qty
    for body in (
        {"ingredient_id": str(priced.ing["Cup"].pk), "mode": "delta", "qty_delta": "-4"},
        {
            "ingredient_id": str(priced.ing["Whole Milk"].pk),
            "mode": "count",
            "counted_qty": str(milk + 50),
        },
    ):
        r = admin_c.post("/api/v1/inventory/adjustments", {**body, "reason": "x"}, format="json")
        assert r.status_code == 201, r.content

    p = report(admin_c, "profit")
    purchases = Decimal(p["purchases_info"]) - Decimal("400.00")  # the first buy is in `start`
    expected = (
        start
        + purchases
        - Decimal(p["cost_of_sales"])
        - Decimal(p["stock_losses"])
        + Decimal(p["stock_added_info"])
    )
    assert abs(stock_value(priced) - expected) < Decimal("0.05"), (stock_value(priced), expected)
    assert Decimal(p["stock_losses"]) > 0 and Decimal(p["stock_added_info"]) == Decimal("1.50")


def test_profit_uses_prices_before_tax(admin_c, barista_c, priced, org):
    buy(admin_c, priced.ing["Coffee Beans"], "1", "1000", "400.00")
    buy(admin_c, priced.ing["Coffee Beans"], "1", "1000", "460.00")  # 0.62 per g
    s = OrganizationSettings.objects.get(organization=org)
    s.tax_enabled, s.tax_rate, s.prices_include_tax = True, Decimal("14.00"), False
    s.save()
    open_shift(barista_c)
    r = checkout(barista_c, [item(priced.large, 3)], [cash("273.60")], "273.60")
    assert r.status_code == 201, r.content
    small = data(checkout(barista_c, [item(priced.small)], [cash("74.10")], "74.10"))
    assert refund(barista_c, small["order_id"], "74.10").status_code == 201

    p = report(admin_c, "profit")
    # sales 240 + 65 before tax; the refund takes the 65 back (the tax is not the cafe's money)
    assert (p["sales"], p["refunds"], p["net_sales"]) == ("305.00", "65.00", "240.00")
    # 3 Large: 56.7 g x 0.62 + 900 ml x 0.03 + 3 cups x 1.50 = 35.154 + 27 + 4.5 = 66.65;
    # Small: 12.6 g x 0.62 + 200 ml x 0.03 + 1.50 = 15.31 (refunded: the cost stays)
    assert p["cost_of_sales"] == "81.96" and p["gross_profit"] == "158.04"
    assert p["gross_margin_pct"] == "65.85"  # 158.04 / 240


def test_a_refund_on_a_later_day_counts_on_that_day(admin_c, barista_c, priced, org):
    buy(admin_c, priced.ing["Coffee Beans"], "1", "1000", "400.00")
    open_shift(barista_c)
    oid = sell(barista_c, priced, [cash("65.00")], "65.00")
    assert refund(barista_c, oid, "65.00").status_code == 201
    tomorrow = timezone.now() + timedelta(days=1)
    Refund.objects.filter(order_id=oid).update(created_at=tomorrow)
    cost = Order.objects.get(pk=oid).cost_total  # 12.6 x 0.70 + 6 + 1.5 = 16.32
    assert cost == Decimal("16.32")

    today = datetime.now(ZoneInfo(org_timezone(org))).date()
    day, next_day = today.isoformat(), (today + timedelta(days=1)).isoformat()
    sale_day = report(admin_c, "profit", **{"from": day, "to": day})
    assert (sale_day["net_sales"], sale_day["cost_of_sales"]) == ("65.00", "16.32")
    assert sale_day["gross_profit"] == "48.68"
    refund_day = report(admin_c, "profit", **{"from": next_day, "to": next_day})
    assert (refund_day["sales"], refund_day["refunds"], refund_day["net_sales"]) == (
        "0.00",
        "65.00",
        "-65.00",
    )
    assert refund_day["cost_of_sales"] == "0.00" and refund_day["gross_profit"] == "-65.00"
    # a day with only refunds has no margin (not -65 / -65 = 100 %)
    assert refund_day["gross_margin_pct"] is None
    both = report(admin_c, "profit", **{"from": day, "to": next_day})
    assert both["net_sales"] == "0.00" and both["gross_profit"] == "-16.32"
    assert both["gross_margin_pct"] is None
