"""Money review (owner, 2026-11-16): exact pack prices, ingredients in use, weighted average cost,
cost of each sale, purchase void, cash in/out of the drawer, the gap between shifts, and the
money in & out and profit reports. The last test runs a whole day and checks every pound."""

import uuid
from decimal import Decimal

import pytest

from apps.audit.models import AuditEvent
from apps.expenses.models import Expense
from apps.inventory.models import StockBalance, StockMovement
from apps.purchasing.models import Purchase
from apps.sales.models import Order
from apps.sales.tests.conftest import card, cash, close_shift, open_shift, refund, sell
from apps.shifts.models import CashMovement
from conftest import data

pytestmark = pytest.mark.django_db


def key():
    return {"Idempotency-Key": str(uuid.uuid4())}


def report(c, name, **params):
    r = c.get(f"/api/v1/reports/{name}", params)
    assert r.status_code == 200, r.content
    return r.json()["data"]


def buy(c, ing, packs, size, pack_cost, post=True, source="external", method="transfer"):
    body = {
        "purchased_on": "2026-11-16",
        "source": source,
        "payment_method": "cash" if source == "cash_drawer" else method,
        "items": [
            {
                "ingredient_id": str(ing.pk),
                "pack_count": packs,
                "pack_size": size,
                "pack_cost": pack_cost,
            }
        ],
    }
    r = c.post("/api/v1/purchases", body, format="json")
    assert r.status_code == 201, r.content
    pid = data(r)["id"]
    if post:
        r = c.post(f"/api/v1/purchases/{pid}/post", {}, format="json", headers=key())
        assert r.status_code == 200, r.content
    return pid


def move(c, kind, amount, reason="Safe", k=None):
    return c.post(
        "/api/v1/shifts/current/cash-movements",
        {"kind": kind, "amount": amount, "reason": reason},
        format="json",
        headers={"Idempotency-Key": k or str(uuid.uuid4())},
    )


def bal(ing):
    return StockBalance.objects.get(ingredient=ing)


@pytest.fixture
def costed(shop):
    """Milk and cups have a reference cost; coffee gets its cost from purchases."""
    shop.ing["Whole Milk"].reference_unit_cost = Decimal("0.0300")
    shop.ing["Whole Milk"].save()
    shop.ing["Cup"].reference_unit_cost = Decimal("1.5000")
    shop.ing["Cup"].save()
    return shop


# --- 1. what was typed is what is paid -------------------------------------------------------


def test_pack_price_is_saved_exactly(admin_c, shop):
    pid = buy(admin_c, shop.ing["Coffee Beans"], "10.000", "1000.000", "160.75", post=False)
    p = data(admin_c.get(f"/api/v1/purchases/{pid}"))
    line = p["items"][0]
    assert p["total"] == "1607.50" and line["line_total"] == "1607.50"  # was 1608.00
    assert line["pack_cost"] == "160.7500" and line["unit_cost"] == "0.1608"  # shown only
    r = admin_c.post(f"/api/v1/purchases/{pid}/post", {}, format="json", headers=key())
    assert Expense.objects.get(purchase_id=pid).amount == Decimal("1607.50")
    assert data(r)["total"] == "1607.50"


def test_pack_cost_rules(admin_c, shop):
    ing = str(shop.ing["Cup"].pk)

    def post(item):
        return admin_c.post(
            "/api/v1/purchases", {"purchased_on": "2026-11-16", "items": [item]}, format="json"
        )

    assert post({"ingredient_id": ing, "qty": "5.000", "pack_cost": "1.00"}).status_code == 400
    both = {"ingredient_id": ing, "pack_count": "1", "pack_size": "5", "pack_cost": "5"}
    assert post({**both, "unit_cost": "1.0000"}).status_code == 400
    assert post({"ingredient_id": ing, "qty": "5.000"}).status_code == 400  # no price at all
    old = post({"ingredient_id": ing, "qty": "3.000", "unit_cost": "0.3333"})  # still works
    assert data(old)["total"] == "1.00"


# --- 2. an ingredient in use cannot be switched off ------------------------------------------


def test_ingredient_in_use_cannot_be_switched_off(admin_c, shop):
    coffee = shop.ing["Coffee Beans"]
    r = admin_c.patch(f"/api/v1/ingredients/{coffee.pk}", {"is_active": False}, format="json")
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "INGREDIENT_IN_USE"
    assert "Iced Latte (Small)" in err["details"]["used_by"]
    assert "Extras: Extra Shot" in err["details"]["used_by"]
    r = admin_c.post("/api/v1/ingredients", {"name": "Straw", "base_unit": "pcs"}, format="json")
    straw = data(r)["id"]
    r = admin_c.patch(f"/api/v1/ingredients/{straw}", {"is_active": False}, format="json")
    assert r.status_code == 200


def test_stock_report_keeps_switched_off_ingredient_with_stock(admin_c, shop):
    r = admin_c.post("/api/v1/ingredients", {"name": "Straw", "base_unit": "pcs"}, format="json")
    straw = data(r)["id"]
    admin_c.post(
        "/api/v1/inventory/opening-balances",
        {"items": [{"ingredient_id": straw, "qty": "50"}]},
        format="json",
    )
    admin_c.patch(f"/api/v1/ingredients/{straw}", {"is_active": False}, format="json")
    rows = {r["name"]: r for r in report(admin_c, "stock")["ingredients"]}
    assert rows["Straw"]["is_active"] is False and rows["Straw"]["balance"] == "50.000"


# --- 8. weighted average cost and the cost of each sale -------------------------------------


def test_weighted_average_cost(admin_c, shop):
    coffee = shop.ing["Coffee Beans"]  # 1000 g opening, no cost known
    buy(admin_c, coffee, "1", "1000", "400.00")  # no cost on hand: the purchase price
    assert bal(coffee).avg_cost == Decimal("0.400000")
    buy(admin_c, coffee, "1", "1000", "460.00")  # 2 kg at 400 + 1 kg at 460 -> 420 per kg
    b = bal(coffee)
    assert b.qty == Decimal("3000.000") and b.avg_cost == Decimal("0.420000")
    mv = StockMovement.objects.filter(ingredient=coffee, movement_type="purchase")
    assert sorted(m.unit_cost for m in mv) == [Decimal("0.400000"), Decimal("0.460000")]


def test_negative_stock_takes_the_purchase_price(admin_c, shop):
    cup = shop.ing["Cup"]
    admin_c.post(
        "/api/v1/inventory/adjustments",
        {"ingredient_id": str(cup.pk), "mode": "count", "counted_qty": "0", "reason": "x"},
        format="json",
    )
    buy(admin_c, cup, "1", "100", "200.00")
    assert bal(cup).avg_cost == Decimal("2.000000")


def test_each_sale_saves_its_cost(admin_c, barista_c, costed):
    buy(admin_c, costed.ing["Coffee Beans"], "1", "1000", "400.00")
    buy(admin_c, costed.ing["Coffee Beans"], "1", "1000", "460.00")  # 0.42 per g
    open_shift(barista_c)
    oid = sell(barista_c, costed, [cash("65.00")], "65.00")
    o = Order.objects.get(pk=oid)
    # 12.6 g x 0.42 + 200 ml x 0.03 + 1 cup x 1.50 = 5.292 + 6 + 1.5 = 12.792
    assert o.cost_total == Decimal("12.79")
    item = o.items.get()
    assert item.cost_total == Decimal("12.79")
    rows = {r["ingredient_name"]: r for r in item.consumption_snapshot}
    assert rows["Coffee Beans"]["unit_cost"] == "0.420000"
    assert rows["Coffee Beans"]["cost"] == "5.29"
    sale = StockMovement.objects.get(ingredient=costed.ing["Cup"], movement_type="sale")
    assert sale.unit_cost == Decimal("1.500000")
    detail = data(admin_c.get(f"/api/v1/orders/{oid}"))
    assert detail["cost_total"] == "12.79" and detail["items"][0]["cost_total"] == "12.79"
    seen_by_barista = data(barista_c.get(f"/api/v1/orders/{oid}"))
    assert "cost_total" not in seen_by_barista
    assert "cost_total" not in seen_by_barista["items"][0]


def test_unknown_cost_is_never_zero(barista_c, shop):
    open_shift(barista_c)
    oid = sell(barista_c, shop, [cash("65.00")], "65.00")  # no ingredient has a cost
    o = Order.objects.get(pk=oid)
    assert o.cost_total is None and o.items.get().cost_total is None


# --- 6. void a posted purchase ---------------------------------------------------------------


def test_void_purchase_reverses_stock_cost_and_expense(admin_c, shop):
    coffee = shop.ing["Coffee Beans"]
    buy(admin_c, coffee, "1", "1000", "400.00")
    pid = buy(admin_c, coffee, "1", "1000", "460.00")
    r = admin_c.post(f"/api/v1/purchases/{pid}/void", {"reason": "Wrong invoice"}, format="json")
    assert r.status_code == 200, r.content
    p = data(r)
    assert p["status"] == "voided" and p["void_reason"] == "Wrong invoice" and p["voided_by"]
    b = bal(coffee)
    assert b.qty == Decimal("2000.000") and b.avg_cost == Decimal("0.400000")  # back to before
    mv = StockMovement.objects.get(movement_type="purchase_void")
    assert mv.qty_delta == Decimal("-1000.000") and mv.unit_cost == Decimal("0.460000")
    exp = Expense.objects.get(purchase_id=pid)
    assert exp.status == "voided" and exp.void_reason == "Wrong invoice"
    assert AuditEvent.objects.filter(action="purchase.voided", entity_id=str(pid)).exists()
    again = admin_c.post(f"/api/v1/purchases/{pid}/void", {"reason": "x"}, format="json")
    assert again.status_code == 409
    pe = report(admin_c, "purchases-expenses")
    assert pe["purchase_total"] == "400.00"  # the voided one is out


def test_void_purchase_rules(admin_c, shop, admin):
    draft = buy(admin_c, shop.ing["Cup"], "1", "10", "10.00", post=False)
    r = admin_c.post(f"/api/v1/purchases/{draft}/void", {"reason": "x"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["details"]["why"] == "draft"
    posted = buy(admin_c, shop.ing["Cup"], "1", "10", "10.00")
    assert (
        admin_c.post(f"/api/v1/purchases/{posted}/void", {"reason": " "}, format="json").status_code
        == 400
    )  # noqa: E501
    # a drawer purchase of a closed shift is frozen
    s = open_shift(admin_c, "500.00")
    drawer = buy(admin_c, shop.ing["Cup"], "1", "10", "10.00", source="cash_drawer")
    assert close_shift(admin_c, s["id"], "490.00").status_code == 200
    r = admin_c.post(f"/api/v1/purchases/{drawer}/void", {"reason": "x"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["details"]["why"] == "shift_closed"
    assert Purchase.objects.get(pk=drawer).status == "posted"


def test_void_drawer_purchase_while_shift_open_gives_the_cash_back(admin_c, shop):
    s = open_shift(admin_c, "500.00")
    pid = buy(admin_c, shop.ing["Cup"], "1", "10", "10.00", source="cash_drawer")
    assert data(admin_c.get("/api/v1/shifts/current"))["totals"]["expected_cash"] == "490.00"
    admin_c.post(f"/api/v1/purchases/{pid}/void", {"reason": "Returned"}, format="json")
    assert data(admin_c.get(f"/api/v1/shifts/{s['id']}"))["totals"]["expected_cash"] == "500.00"


# --- 5b. cash put in / taken out -------------------------------------------------------------


def test_cash_in_and_out_change_expected_cash(barista_c, admin_c, shop, barista):
    s = open_shift(barista_c, "100.00")
    k = str(uuid.uuid4())
    r = move(barista_c, "out", "60.00", "To the safe", k=k)
    assert r.status_code == 201 and r.json()["data"]["kind"] == "out"
    replay = move(barista_c, "out", "60.00", "To the safe", k=k)  # same key: no second movement
    assert replay.status_code == 201 and replay.headers["Idempotent-Replayed"] == "true"
    assert move(barista_c, "in", "20.00", "Change from the owner").status_code == 201
    d = data(barista_c.get("/api/v1/shifts/current"))
    assert (d["totals"]["cash_in"], d["totals"]["cash_out"]) == ("20.00", "60.00")
    assert d["totals"]["expected_cash"] == "60.00"  # 100 + 20 - 60
    assert [m["reason"] for m in d["cash_movements"]] == ["To the safe", "Change from the owner"]
    assert CashMovement.objects.count() == 2
    assert AuditEvent.objects.filter(action="cash.removed").count() == 1
    assert AuditEvent.objects.filter(action="cash.added").count() == 1
    # Admin cancels one while the shift is open
    out_id = d["cash_movements"][0]["id"]
    assert (
        barista_c.post(
            f"/api/v1/cash-movements/{out_id}/void", {"reason": "x"}, format="json"
        ).status_code
        == 403
    )  # noqa: E501
    r = admin_c.post(f"/api/v1/cash-movements/{out_id}/void", {"reason": "Typo"}, format="json")
    assert r.status_code == 200 and data(r)["status"] == "voided"
    assert data(barista_c.get("/api/v1/shifts/current"))["totals"]["expected_cash"] == "120.00"
    again = admin_c.post(f"/api/v1/cash-movements/{out_id}/void", {"reason": "x"}, format="json")
    assert again.status_code == 422
    closed = data(close_shift(barista_c, s["id"], "120.00"))
    assert closed["difference"] == "0.00" and closed["totals"]["cash_in"] == "20.00"
    in_id = closed["cash_movements"][1]["id"]
    r = admin_c.post(f"/api/v1/cash-movements/{in_id}/void", {"reason": "x"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["details"]["why"] == "shift_closed"


def test_cash_movement_rules(barista_c, shop):
    assert move(barista_c, "out", "10.00").status_code == 409  # no open shift
    open_shift(barista_c)
    assert move(barista_c, "out", "0.00").status_code == 400
    assert move(barista_c, "out", "10.00", reason="  ").status_code == 400
    assert move(barista_c, "sideways", "10.00").status_code == 400
    r = barista_c.post(
        "/api/v1/shifts/current/cash-movements",
        {"kind": "out", "amount": "1.00", "reason": "x"},
        format="json",
    )
    assert r.status_code == 400  # no Idempotency-Key


# --- 5a. the gap between shifts --------------------------------------------------------------


def test_gap_between_shifts(barista_c, admin_c, shop):
    s1 = open_shift(barista_c, "100.00")
    sell(barista_c, shop, [cash("65.00")], "65.00")
    close_shift(barista_c, s1["id"], "165.00")
    s2 = open_shift(barista_c, "100.00")  # 65 left the drawer between the shifts
    d = data(barista_c.get("/api/v1/shifts/current"))
    gap = d["since_previous_close"]
    assert gap["previous_actual_cash"] == "165.00" and gap["difference"] == "-65.00"
    rows = {r["id"]: r for r in report(admin_c, "shifts")["shifts"]}
    assert rows[s2["id"]]["gap"] == "-65.00" and rows[s1["id"]]["gap"] is None
    assert report(admin_c, "shifts")["gap_total"] == "-65.00"


# --- 4 and 8. the reports, and a whole day where every pound must add up --------------------


def test_a_whole_day_every_pound_and_gram(admin_c, barista_c, costed):
    coffee, milk, cup = (costed.ing[n] for n in ("Coffee Beans", "Whole Milk", "Cup"))
    buy(admin_c, coffee, "1", "1000", "400.00")  # external transfer
    buy(admin_c, coffee, "1", "1000", "460.00")  # avg 0.42
    wrong = buy(admin_c, cup, "1", "100", "999.00", method="card")
    admin_c.post(f"/api/v1/purchases/{wrong}/void", {"reason": "Wrong price"}, format="json")

    s = open_shift(barista_c, "200.00")
    a = sell(barista_c, costed, [cash("65.00")], "65.00")  # cost 12.79
    sell(barista_c, costed, [cash("20.00", "50.00"), card("45.00")], "65.00")  # split, change 30
    c = sell(barista_c, costed, [card("80.00")], "80.00", variant=costed.large)
    assert refund(barista_c, a, "65.00").status_code == 201  # cash back from the drawer
    assert refund(barista_c, c, "80.00").status_code == 201  # card back
    assert move(barista_c, "out", "50.00", "To the safe").status_code == 201
    assert move(barista_c, "in", "10.00", "Coins").status_code == 201
    r = barista_c.post(
        "/api/v1/expenses",
        {"category": "supplies", "description": "Ice", "amount": "15.00"},
        format="json",
    )
    assert r.status_code == 201
    buy(admin_c, milk, "1", "1000", "33.33", post=False)  # a draft moves nothing
    admin_c.post(
        "/api/v1/expenses",
        {
            "category": "rent",
            "description": "Rent",
            "amount": "1000.00",
            "payment_method": "transfer",
        },  # noqa: E501
        format="json",
    )
    admin_c.post(
        "/api/v1/inventory/adjustments",
        {"ingredient_id": str(cup.pk), "mode": "delta", "qty_delta": "-2", "reason": "Broken"},
        format="json",
    )

    # the drawer: 200 + cash sales (65 + 20) - cash refund 65 - expense 15 + 10 in - 50 out
    shift = data(barista_c.get("/api/v1/shifts/current"))
    assert shift["totals"]["expected_cash"] == "165.00"
    closed = data(close_shift(barista_c, s["id"], "160.00"))
    assert closed["expected_cash"] == "165.00" and closed["difference"] == "-5.00"

    m = report(admin_c, "money-in-out")
    rows = {r["key"]: r for r in m["rows"]}
    assert rows["sales"]["cash"] == "85.00" and rows["sales"]["card"] == "125.00"
    assert rows["refunds"]["cash"] == "65.00" and rows["refunds"]["card"] == "80.00"
    assert rows["drawer_expenses"]["cash"] == "15.00"
    assert rows["other_expenses"]["transfer"] == "1000.00"
    assert rows["other_purchases"]["transfer"] == "860.00"  # the voided 999 is out
    assert rows["other_purchases"]["card"] == "0.00"
    assert m["total_in"]["total"] == "210.00"
    assert m["total_out"]["total"] == "2020.00"  # 145 refunds + 15 + 1000 + 860
    assert m["net"]["total"] == "-1810.00"
    assert m["drawer"] == {
        "cash_in": "10.00",
        "cash_out": "50.00",
        "gap_total": "0.00",
        "closed_count": 1,
        "total_difference": "-5.00",
    }
    # the drawer agrees with the money report: opening + cash in the report + moves = expected
    drawer_cash = (
        Decimal(rows["sales"]["cash"])
        - Decimal(rows["refunds"]["cash"])
        - Decimal(rows["drawer_expenses"]["cash"])
        - Decimal(rows["drawer_purchases"]["cash"])
    )
    assert Decimal("200.00") + drawer_cash + 10 - 50 == Decimal(closed["expected_cash"])

    # profit: sales 210 - refunds 145 = 65; cost of the three sales (refunded ones keep their
    # cost: the ingredients were used, D8)
    small = Decimal("12.79")  # 5.292 + 6 + 1.5
    large = Decimal("18.44")  # 18.9 g x 0.42 = 7.938 + 300 ml x 0.03 = 9 + 1.5 = 18.438
    costs = sorted(o.cost_total for o in Order.objects.all())
    assert costs == [small, small, large]
    p = report(admin_c, "profit")
    cogs = small * 2 + large
    assert p["sales"] == "210.00" and p["refunds"] == "145.00" and p["net_sales"] == "65.00"
    assert p["cost_of_sales"] == str(cogs) and p["gross_profit"] == str(Decimal("65.00") - cogs)
    assert p["stock_losses"] == "3.00" and p["stock_gains"] == "0.00"  # 2 cups x 1.50
    assert p["general_expenses"] == "1015.00"  # rent + ice; purchases are stock, not expenses
    assert p["purchases_info"] == "860.00"
    assert p["net_profit"] == str(Decimal("65.00") - cogs - Decimal("3.00") - Decimal("1015.00"))
    assert p["orders_without_cost"] == 0 and p["adjustments_without_cost"] == 0

    # every gram: each balance is the sum of its movements
    for ing in (coffee, milk, cup):
        moved = sum(
            StockMovement.objects.filter(ingredient=ing).values_list("qty_delta", flat=True)
        )
        assert bal(ing).qty == moved, ing.name
    assert bal(cup).qty == Decimal("95.000")  # 100 - 3 sold - 2 broken (the voided 100 is gone)

    st = report(admin_c, "stock")
    rows = {r["name"]: r for r in st["ingredients"]}
    assert rows["Cup"]["unit_cost"] == "1.500000" and rows["Cup"]["value"] == "142.50"
    assert st["without_cost_count"] == 1  # Oat Milk has no cost yet


def test_profit_flags_orders_without_cost(admin_c, barista_c, shop):
    open_shift(barista_c)
    sell(barista_c, shop, [cash("65.00")], "65.00")
    p = report(admin_c, "profit")
    assert p["orders_without_cost"] == 1 and p["sales_without_cost"] == "65.00"
    assert p["cost_of_sales"] == "0.00"


def test_new_reports_refuse_person_filters(admin_c, shop, barista):
    for name in ("money-in-out", "profit"):
        r = admin_c.get(f"/api/v1/reports/{name}", {"cashier_id": str(barista.pk)})
        assert r.status_code == 400
