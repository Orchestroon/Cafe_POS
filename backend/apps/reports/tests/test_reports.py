import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from apps.expenses.models import Expense
from apps.sales.models import Order
from apps.sales.tests.conftest import card, cash, close_shift, open_shift, refund, sell
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db


def report(c, name, **params):
    r = c.get(f"/api/v1/reports/{name}", params)
    assert r.status_code == 200, r.content
    return r.json()


def new_expense(c, **over):
    body = {"category": "supplies", "description": "Ice", "amount": "30.00", **over}
    r = c.post("/api/v1/expenses", body, format="json")
    assert r.status_code == 201, r.content
    return data(r)["id"]


@pytest.fixture
def scenario(org, shop, admin_c, barista_c):
    """AT-22: five sales across methods, two refunds (cash, mixed), a purchase, three expenses."""
    s = open_shift(barista_c, "100.00")
    ids = {}
    ids["A"] = sell(barista_c, shop, [cash("65.00")], "65.00")
    ids["B"] = sell(barista_c, shop, [card("65.00")], "65.00")
    ids["C"] = sell(barista_c, shop, [cash("20.00"), card("45.00")], "65.00")
    ids["D"] = sell(barista_c, shop, [cash("80.00")], "80.00", variant=shop.large)
    ids["E"] = sell(barista_c, shop, [cash("130.00")], "130.00", qty=2)
    assert refund(barista_c, ids["D"], "80.00").status_code == 201
    assert refund(barista_c, ids["C"], "65.00").status_code == 201
    milk = {
        "ingredient_id": str(shop.ing["Whole Milk"].pk),
        "pack_count": "12.000",
        "pack_size": "1000.000",
        "unit_cost": "0.0300",
    }
    pid = data(
        admin_c.post(
            "/api/v1/purchases", {"purchased_on": "2026-11-10", "items": [milk]}, format="json"
        )
    )["id"]
    key = {"Idempotency-Key": str(uuid.uuid4())}
    assert (
        admin_c.post(f"/api/v1/purchases/{pid}/post", {}, format="json", headers=key).status_code
        == 200
    )
    new_expense(barista_c)  # 30.00 from the drawer
    voided = new_expense(barista_c, amount="50.00")
    assert (
        admin_c.post(
            f"/api/v1/expenses/{voided}/void", {"reason": "typo"}, format="json"
        ).status_code
        == 200
    )
    new_expense(
        admin_c, category="rent", description="Rent", amount="1000.00", payment_method="transfer"
    )
    return {"shift": s, "orders": ids}


def test_at22_every_report_reconciles(admin_c, barista_c, scenario):
    s = report(admin_c, "sales-summary")["data"]
    assert s == {
        "orders_count": 5,
        "gross_sales": "405.00",
        "discounts": "0.00",
        "tax": "0.00",
        "collected": "405.00",
        "refunds": "145.00",
        "net_sales": "260.00",
        "refunded_orders_count": 2,
    }
    p = report(admin_c, "payment-breakdown")["data"]
    assert p == {
        "cash_collected": "295.00",
        "card_collected": "110.00",
        "cash_refunded": "100.00",
        "card_refunded": "45.00",
        "cash_net": "195.00",
        "card_net": "65.00",
    }
    # the reconciliation invariants (spec 8.13)
    assert Decimal(p["cash_collected"]) + Decimal(p["card_collected"]) == Decimal(s["collected"])
    assert Decimal(p["cash_refunded"]) + Decimal(p["card_refunded"]) == Decimal(s["refunds"])
    assert Decimal(p["cash_net"]) + Decimal(p["card_net"]) == Decimal(s["net_sales"])

    top = report(admin_c, "top-products")["data"]["products"]  # refunded orders are excluded
    assert top == [
        {
            "variant_id": top[0]["variant_id"],
            "product_name_snapshot": "Iced Latte",
            "variant_label_snapshot": "Small",
            "qty_sold": 4,
            "net_revenue": "260.00",
        }
    ]

    pe = report(admin_c, "purchases-expenses")["data"]
    assert pe["purchase_total"] == "360.00" and pe["general_expenses_total"] == "1030.00"
    assert (
        pe["cash_drawer_total"] == "30.00" and pe["external_total"] == "1360.00"
    )  # the void is out
    assert {b["category"]: b["total"] for b in pe["breakdown"]} == {
        "purchase": "360.00",
        "rent": "1000.00",
        "supplies": "30.00",
    }
    assert Decimal(pe["purchase_total"]) + Decimal(pe["general_expenses_total"]) == Decimal(
        pe["cash_drawer_total"]
    ) + Decimal(pe["external_total"])

    st = {r["name"]: r for r in report(admin_c, "stock")["data"]["ingredients"]}
    assert st["Whole Milk"]["balance"] == "15700.000"  # 5000 - 1300 sold + 12000 bought
    assert st["Whole Milk"]["consumed_qty_period"] == "1300.000"
    assert st["Cup"]["consumed_qty_period"] == "6.000" and st["Cup"]["balance"] == "94.000"
    assert st["Whole Milk"]["is_low"] is False and st["Whole Milk"]["is_negative"] is False

    open_report = report(admin_c, "shifts")["data"]
    assert (open_report["open_count"], open_report["closed_count"]) == (1, 0)
    assert (
        open_report["shifts"][0]["orders_count"] == 5
        and open_report["shifts"][0]["expected"] is None
    )
    d = data(close_shift(barista_c, scenario["shift"]["id"], "260.00"))
    assert d["expected_cash"] == "265.00"  # 100 + 295 cash sales - 100 cash refunds - 30 drawer
    sh = report(admin_c, "shifts")["data"]
    assert sh["shifts_count"] == 1 and sh["closed_count"] == 1 and sh["open_count"] == 0
    assert (sh["expected_cash_total"], sh["actual_cash_total"], sh["total_difference"]) == (
        "265.00",
        "260.00",
        "-5.00",
    )
    row = sh["shifts"][0]
    assert row["difference"] == "-5.00" and row["user"]["display_name"] == "barista"


def test_filters_by_cashier_and_shift(org, admin_c, barista, scenario, shop):
    other = make_user(org, "barista2", "barista")
    oc = client_for(other)
    s2 = open_shift(oc, "0.00")
    sell(oc, shop, [cash("65.00")], "65.00")
    assert report(admin_c, "sales-summary")["data"]["orders_count"] == 6
    mine = report(admin_c, "sales-summary", cashier_id=str(barista.pk))["data"]
    assert (
        mine["orders_count"] == 5 and mine["collected"] == "405.00" and mine["refunds"] == "145.00"
    )
    theirs = report(admin_c, "sales-summary", shift_id=s2["id"])["data"]
    assert (
        theirs["orders_count"] == 1
        and theirs["collected"] == "65.00"
        and theirs["refunds"] == "0.00"
    )
    pay = report(admin_c, "payment-breakdown", shift_id=scenario["shift"]["id"])["data"]
    assert pay["cash_collected"] == "295.00" and pay["cash_refunded"] == "100.00"
    assert (
        report(admin_c, "top-products", cashier_id=str(other.pk))["data"]["products"][0]["qty_sold"]
        == 1
    )
    assert report(admin_c, "shifts", cashier_id=str(other.pk))["data"]["shifts_count"] == 1


def test_top_products_ordering(admin_c, barista_c, shop):
    open_shift(barista_c, "0.00")
    sell(
        barista_c, shop, [cash("160.00")], "160.00", qty=2, variant=shop.large
    )  # qty 2, revenue 160
    for _ in range(3):
        sell(barista_c, shop, [cash("65.00")], "65.00")  # qty 3, revenue 195
    by_rev = report(admin_c, "top-products", ordering="revenue")["data"]["products"]
    by_qty = report(admin_c, "top-products", ordering="qty")["data"]["products"]
    assert [r["variant_label_snapshot"] for r in by_rev] == ["Small", "Large"]
    assert [r["variant_label_snapshot"] for r in by_qty] == ["Small", "Large"]
    by_rev2 = report(admin_c, "top-products")["data"]["products"]
    assert by_rev2 == by_rev
    meta = report(admin_c, "top-products")["meta"]
    assert meta["limit"] == 100 and meta["truncated"] is False


def test_q6_4a_top_products_says_when_rows_were_cut(admin_c, barista_c, shop, monkeypatch):
    from apps.reports import services, views

    monkeypatch.setattr(services, "TOP_PRODUCTS_LIMIT", 1)
    monkeypatch.setattr(views, "TOP_PRODUCTS_LIMIT", 1)
    open_shift(barista_c, "0.00")
    sell(barista_c, shop, [cash("65.00")], "65.00")
    sell(barista_c, shop, [cash("80.00")], "80.00", variant=shop.large)
    body = report(admin_c, "top-products")
    assert len(body["data"]["products"]) == 1 and body["meta"]["truncated"] is True


def test_q6_3a_purchases_expenses_refuses_cashier_and_shift_filters(admin_c, admin):
    for k in ("cashier_id", "shift_id"):
        r = admin_c.get("/api/v1/reports/purchases-expenses", {k: str(admin.pk)})
        assert r.status_code == 400 and k in r.json()["error"]["details"]["fields"]


def test_cairo_date_boundaries(admin_c, barista_c, shop):
    open_shift(barista_c, "0.00")
    late = sell(barista_c, shop, [cash("65.00")], "65.00")  # 23:59:59 Cairo on Jan 9
    early = sell(barista_c, shop, [card("65.00")], "65.00")  # 00:00:00 Cairo on Jan 10
    Order.objects.filter(pk=late).update(created_at=datetime(2026, 1, 9, 21, 59, 59, tzinfo=UTC))
    Order.objects.filter(pk=early).update(created_at=datetime(2026, 1, 9, 22, 0, 0, tzinfo=UTC))
    jan9 = report(admin_c, "sales-summary", **{"from": "2026-01-09", "to": "2026-01-09"})
    jan10 = report(admin_c, "sales-summary", **{"from": "2026-01-10", "to": "2026-01-10"})
    assert jan9["data"]["orders_count"] == 1 and jan10["data"]["orders_count"] == 1
    assert (
        report(admin_c, "payment-breakdown", **{"from": "2026-01-09", "to": "2026-01-09"})["data"][
            "cash_collected"
        ]
        == "65.00"
    )
    assert (
        report(admin_c, "payment-breakdown", **{"from": "2026-01-10", "to": "2026-01-10"})["data"][
            "card_collected"
        ]
        == "65.00"
    )
    both = report(admin_c, "sales-summary", **{"from": "2026-01-09", "to": "2026-01-10"})
    assert both["data"]["orders_count"] == 2
    assert jan10["meta"]["range"] == {
        "from": "2026-01-10",
        "to": "2026-01-10",
        "timezone": "Africa/Cairo",
        "start_utc": "2026-01-09T22:00:00Z",
        "end_utc": "2026-01-10T22:00:00Z",
    }
    # expenses use their paid_at with the same boundaries
    eid = Expense.objects.create(
        organization=Order.objects.get(pk=late).organization,
        category="other",
        description="x",
        amount="7.00",
        payment_method="cash",
        source="external",
        created_by=Order.objects.get(pk=late).cashier,
    ).pk
    Expense.objects.filter(pk=eid).update(paid_at=datetime(2026, 1, 9, 22, 0, 0, tzinfo=UTC))
    assert (
        report(admin_c, "purchases-expenses", **{"from": "2026-01-09", "to": "2026-01-09"})["data"][
            "external_total"
        ]
        == "0.00"
    )
    assert (
        report(admin_c, "purchases-expenses", **{"from": "2026-01-10", "to": "2026-01-10"})["data"][
            "external_total"
        ]
        == "7.00"
    )


def test_default_period_is_today_and_empty_reports_are_zero(admin_c):
    r = report(admin_c, "sales-summary")
    assert r["data"]["orders_count"] == 0 and r["data"]["net_sales"] == "0.00"
    assert r["meta"]["range"]["from"] == r["meta"]["range"]["to"]
    assert report(admin_c, "payment-breakdown")["data"]["cash_net"] == "0.00"
    assert report(admin_c, "top-products")["data"]["products"] == []
    assert report(admin_c, "purchases-expenses")["data"]["breakdown"] == []
    assert report(admin_c, "shifts")["data"]["shifts"] == []


@pytest.mark.parametrize(
    "params",
    [
        {"from": "nope"},
        {"to": "2026-13-01"},
        {"from": "2026-02-02", "to": "2026-02-01"},
        {"cashier_id": "x"},
        {"shift_id": "x"},
        {"ordering": "bogus"},
    ],
)
def test_bad_parameters_are_400(admin_c, params):
    for name in ("sales-summary", "top-products", "shifts"):
        r = admin_c.get(f"/api/v1/reports/{name}", params)
        assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_reports_are_admin_only_and_tenant_scoped(admin2_c, barista_c, scenario):
    assert barista_c.get("/api/v1/reports/sales-summary").status_code == 403
    assert report(admin2_c, "sales-summary")["data"]["orders_count"] == 0
    assert report(admin2_c, "purchases-expenses")["data"]["purchase_total"] == "0.00"
    assert report(admin2_c, "shifts")["data"]["shifts"] == []
    assert report(admin2_c, "stock")["data"]["ingredients"] == []
    assert report(admin2_c, "payment-breakdown")["data"]["cash_collected"] == "0.00"
    assert report(admin2_c, "top-products")["data"]["products"] == []
