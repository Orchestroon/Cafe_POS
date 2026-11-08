import threading
from decimal import Decimal

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.inventory.models import Ingredient, StockAdjustment, StockBalance, StockMovement
from apps.tenancy.seed import default_location
from conftest import client_for, data

pytestmark = pytest.mark.django_db
D = Decimal


def new_ing(c, name="Milk", unit="ml", **kw):
    r = c.post("/api/v1/ingredients", {"name": name, "base_unit": unit, **kw}, format="json")
    assert r.status_code == 201, r.content
    return data(r)


def balance(ing_id):
    return StockBalance.objects.get(ingredient_id=ing_id).qty


def test_ingredient_creates_zero_balance_in_default_location(admin_c, org):
    ing = new_ing(admin_c, low_stock_threshold="500.000", reference_unit_cost="0.0450")
    b = StockBalance.objects.get(ingredient_id=ing["id"])
    assert b.qty == 0 and b.location.is_default and b.location.organization == org
    assert ing["low_stock_threshold"] == "500.000" and ing["reference_unit_cost"] == "0.0450"


@pytest.mark.parametrize("unit", ["g", "ml", "pcs"])
def test_units(admin_c, unit):
    assert new_ing(admin_c, name=f"I-{unit}", unit=unit)["base_unit"] == unit


def test_ingredient_validation(admin_c):
    new_ing(admin_c)
    assert (
        admin_c.post(
            "/api/v1/ingredients", {"name": "milk", "base_unit": "ml"}, format="json"
        ).status_code
        == 400
    )
    assert (
        admin_c.post(
            "/api/v1/ingredients", {"name": "X", "base_unit": "kg"}, format="json"
        ).status_code
        == 400
    )
    assert (
        admin_c.post(
            "/api/v1/ingredients",
            {"name": "X", "base_unit": "g", "low_stock_threshold": 5},
            format="json",
        ).status_code
        == 400
    )


@pytest.mark.parametrize("field", ["qty", "balance", "stock", "opening_balance", "location_id"])
def test_ingredient_patch_rejects_balance_fields(admin_c, field):
    ing = new_ing(admin_c)
    r = admin_c.patch(f"/api/v1/ingredients/{ing['id']}", {field: "100.000"}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert balance(ing["id"]) == 0 and not StockMovement.objects.exists()


def test_ingredient_patch_metadata_only_and_unit_is_immutable(admin_c):
    ing = new_ing(admin_c)
    url = f"/api/v1/ingredients/{ing['id']}"
    r = admin_c.patch(
        url,
        {"name": "Whole Milk", "is_active": False, "low_stock_threshold": "100.000"},
        format="json",
    )
    assert (
        r.status_code == 200 and data(r)["name"] == "Whole Milk" and data(r)["is_active"] is False
    )
    assert admin_c.patch(url, {"base_unit": "g"}, format="json").status_code == 400
    assert AuditEvent.objects.filter(action="ingredient.updated").count() == 1


def test_opening_balance_creates_movement_and_audit(admin_c):
    a, b = new_ing(admin_c, "A", "g"), new_ing(admin_c, "B", "pcs")
    r = admin_c.post(
        "/api/v1/inventory/opening-balances",
        {
            "items": [
                {"ingredient_id": a["id"], "qty": "5000.000"},
                {"ingredient_id": b["id"], "qty": "100.000"},
            ]
        },
        format="json",
    )
    assert r.status_code == 201
    assert balance(a["id"]) == D("5000") and balance(b["id"]) == D("100")
    m = StockMovement.objects.get(ingredient_id=a["id"])
    assert (m.movement_type, m.source_type, m.qty_delta, m.balance_after) == (
        "opening_balance",
        "stock_adjustment",
        D("5000"),
        D("5000"),
    )
    assert AuditEvent.objects.filter(action="stock.opening_balance").count() == 2


def test_opening_balance_rejected_when_movements_exist_and_all_or_nothing(admin_c):
    a, b = new_ing(admin_c, "A", "g"), new_ing(admin_c, "B", "g")
    admin_c.post(
        "/api/v1/inventory/adjustments",
        {"ingredient_id": a["id"], "mode": "delta", "qty_delta": "10", "reason": "found"},
        format="json",
    )
    r = admin_c.post(
        "/api/v1/inventory/opening-balances",
        {
            "items": [
                {"ingredient_id": b["id"], "qty": "50.000"},
                {"ingredient_id": a["id"], "qty": "50.000"},
            ]
        },
        format="json",
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "OPENING_BALANCE_EXISTS"
    assert balance(b["id"]) == 0  # nothing partially applied
    assert StockMovement.objects.count() == 1
    again = admin_c.post(
        "/api/v1/inventory/opening-balances",
        {"items": [{"ingredient_id": b["id"], "qty": "50.000"}]},
        format="json",
    )
    assert again.status_code == 201
    second = admin_c.post(
        "/api/v1/inventory/opening-balances",
        {"items": [{"ingredient_id": b["id"], "qty": "50.000"}]},
        format="json",
    )
    assert second.status_code == 409 and balance(b["id"]) == D("50")


@pytest.mark.parametrize(
    "items", [[], [{"ingredient_id": "00000000-0000-0000-0000-000000000000", "qty": "1.000"}]]
)
def test_opening_balance_validation(admin_c, items):
    assert (
        admin_c.post(
            "/api/v1/inventory/opening-balances", {"items": items}, format="json"
        ).status_code
        == 400
    )


def test_opening_balance_qty_must_be_positive_string_and_unique(admin_c):
    a = new_ing(admin_c, "A", "g")
    for qty in ("0.000", "-1.000", 5):
        r = admin_c.post(
            "/api/v1/inventory/opening-balances",
            {"items": [{"ingredient_id": a["id"], "qty": qty}]},
            format="json",
        )
        assert r.status_code == 400
    dup = {"items": [{"ingredient_id": a["id"], "qty": "1.000"}] * 2}
    assert admin_c.post("/api/v1/inventory/opening-balances", dup, format="json").status_code == 400


def adjust(c, ing, **kw):
    return c.post(
        "/api/v1/inventory/adjustments", {"ingredient_id": ing["id"], **kw}, format="json"
    )


def test_adjustment_requires_reason(admin_c):
    a = new_ing(admin_c)
    for bad in ({}, {"reason": ""}, {"reason": "   "}):
        assert adjust(admin_c, a, mode="delta", qty_delta="5.000", **bad).status_code == 400
        assert adjust(admin_c, a, mode="count", counted_qty="5.000", **bad).status_code == 400
    assert balance(a["id"]) == 0 and not StockAdjustment.objects.exists()


def test_delta_adjustment_updates_balance_ledger_and_audit(admin_c):
    a = new_ing(admin_c)
    r = adjust(admin_c, a, mode="delta", qty_delta="250.500", reason="Delivery")
    assert r.status_code == 201 and data(r)["balance_after"] == "250.500"
    adjust(admin_c, a, mode="delta", qty_delta="-50.000", reason="Spill")
    assert balance(a["id"]) == D("200.500")
    ms = list(
        StockMovement.objects.order_by("created_at").values_list(
            "qty_delta", "balance_after", "movement_type"
        )
    )
    assert ms == [(D("250.5"), D("250.5"), "adjustment"), (D("-50"), D("200.5"), "adjustment")]
    ev = AuditEvent.objects.filter(action="stock.adjusted").latest("created_at")
    assert ev.summary["reason"] == "Spill" and ev.summary["balance_before"] == "250.500"


def test_balance_may_go_negative(admin_c):
    a = new_ing(admin_c)
    adjust(admin_c, a, mode="delta", qty_delta="-5.000", reason="Waste")
    assert balance(a["id"]) == D("-5")
    assert (
        data(admin_c.get("/api/v1/inventory/balances?is_negative=true"))[0]["is_negative"] is True
    )


def test_count_computes_delta_from_current_balance(admin_c):
    a = new_ing(admin_c)
    adjust(admin_c, a, mode="delta", qty_delta="100.000", reason="start")
    r = adjust(admin_c, a, mode="count", counted_qty="80.000", reason="Monthly count")
    assert (
        r.status_code == 201
        and data(r)["qty_delta"] == "-20.000"
        and data(r)["balance_after"] == "80.000"
    )
    last = StockMovement.objects.latest("created_at")
    assert last.qty_delta == D("-20") and last.balance_after == D("80")
    adj = StockAdjustment.objects.get(kind="count")
    assert adj.counted_qty == D("80") and adj.qty_delta == D("-20")
    up = adjust(admin_c, a, mode="count", counted_qty="95.500", reason="recount")
    assert data(up)["qty_delta"] == "15.500" and balance(a["id"]) == D("95.5")


def test_count_with_zero_delta_records_count_without_movement(admin_c):
    a = new_ing(admin_c)
    adjust(admin_c, a, mode="delta", qty_delta="40.000", reason="start")
    r = adjust(admin_c, a, mode="count", counted_qty="40.000", reason="Verified")
    assert r.status_code == 201 and data(r)["movement_id"] is None
    assert (
        StockMovement.objects.count() == 1
        and StockAdjustment.objects.filter(kind="count").count() == 1
    )
    assert AuditEvent.objects.filter(action="stock.counted").count() == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "delta"},
        {"mode": "delta", "qty_delta": "0.000"},
        {"mode": "delta", "qty_delta": 5},
        {"mode": "delta", "qty_delta": "1.000", "counted_qty": "1.000"},
        {"mode": "count"},
        {"mode": "count", "counted_qty": "-1.000"},
        {"mode": "count", "counted_qty": "1", "qty_delta": "1"},
        {"mode": "other", "qty_delta": "1.000"},
        {"mode": "delta", "qty_delta": "1.0001"},
    ],
)
def test_adjustment_validation(admin_c, payload):
    a = new_ing(admin_c)
    assert adjust(admin_c, a, reason="because", **payload).status_code == 400
    assert not StockMovement.objects.exists()


def test_adjustment_unknown_ingredient_404(admin_c):
    r = admin_c.post(
        "/api/v1/inventory/adjustments",
        {
            "ingredient_id": "00000000-0000-0000-0000-000000000000",
            "mode": "delta",
            "qty_delta": "1.000",
            "reason": "x",
        },
        format="json",
    )
    assert r.status_code == 404


def test_movements_are_append_only(admin_c, admin):
    a = new_ing(admin_c)
    adjust(admin_c, a, mode="delta", qty_delta="10.000", reason="x")
    m = StockMovement.objects.get()
    m.qty_delta = D("99")
    with pytest.raises(RuntimeError):
        m.save()
    with pytest.raises(RuntimeError):
        m.delete()
    with pytest.raises(RuntimeError):
        StockMovement.objects.filter(pk=m.pk).update(qty_delta=1)
    with pytest.raises(RuntimeError):
        StockMovement.objects.all().delete()
    assert StockMovement.objects.get().qty_delta == D("10")


def test_movement_db_constraints(admin_c, org, admin):
    from django.db import IntegrityError, transaction

    a = new_ing(admin_c)
    bal = StockBalance.objects.get(ingredient_id=a["id"])
    kw = dict(
        organization=org,
        ingredient_id=a["id"],
        location=bal.location,
        movement_type="adjustment",
        source_type="stock_adjustment",
        balance_after=0,
        created_by=admin,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        StockMovement.objects.create(qty_delta=0, **kw)
    sid = StockAdjustment.objects.create(
        organization=org,
        ingredient_id=a["id"],
        location=bal.location,
        kind="adjustment",
        qty_delta=1,
        reason="r",
        created_by=admin,
    ).id
    StockMovement.objects.create(qty_delta=1, source_id=sid, **kw)
    with pytest.raises(IntegrityError), transaction.atomic():  # no double posting
        StockMovement.objects.create(qty_delta=1, source_id=sid, **kw)


def test_balances_and_movements_endpoints_filters(admin_c):
    low, ok = (
        new_ing(admin_c, "Low", "g", low_stock_threshold="100.000"),
        new_ing(admin_c, "Ok", "g", low_stock_threshold="100.000"),
    )
    adjust(admin_c, low, mode="delta", qty_delta="50.000", reason="x")
    adjust(admin_c, ok, mode="delta", qty_delta="500.000", reason="x")

    def names(q):
        return [b["ingredient_name"] for b in data(admin_c.get(f"/api/v1/inventory/balances{q}"))]

    assert (
        names("?is_low=true") == ["Low"]
        and names("?search=ok") == ["Ok"]
        and names("") == ["Low", "Ok"]
    )

    def mv(q):
        return admin_c.get(f"/api/v1/inventory/movements{q}").json()["meta"]["total_count"]

    assert mv("") == 2 and mv(f"?ingredient_id={low['id']}") == 1 and mv("?movement_type=sale") == 0
    assert mv("?from=2000-01-01&to=2000-01-02") == 0 and mv("?from=2000-01-01") == 2
    assert admin_c.get("/api/v1/inventory/movements?from=bad").status_code == 400


def test_movement_date_filter_uses_org_timezone(admin_c, org):
    from datetime import UTC, datetime

    a = new_ing(admin_c)
    adjust(admin_c, a, mode="delta", qty_delta="1.000", reason="x")
    # 22:30 UTC on Jan 9 is 00:30 on Jan 10 in Cairo (+02:00)
    with connection.cursor() as cur:
        cur.execute(
            "UPDATE inventory_stockmovement SET occurred_at=%s",
            [datetime(2026, 1, 9, 22, 30, tzinfo=UTC)],
        )

    def on(d):
        r = admin_c.get(f"/api/v1/inventory/movements?from={d}&to={d}")
        return r.json()["meta"]["total_count"]

    assert on("2026-01-10") == 1 and on("2026-01-09") == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_adjustments_do_not_lose_updates(org, admin):
    """Row lock (select_for_update) serializes read-modify-write on the balance."""
    ing = Ingredient.objects.create(organization=org, name="Beans", base_unit="g")
    StockBalance.objects.create(organization=org, ingredient=ing, location=default_location(org))
    errors = []

    def work():
        try:
            c = client_for(admin)
            for _ in range(5):
                r = c.post(
                    "/api/v1/inventory/adjustments",
                    {
                        "ingredient_id": str(ing.id),
                        "mode": "delta",
                        "qty_delta": "1.000",
                        "reason": "t",
                    },
                    format="json",
                )
                assert r.status_code == 201
        except Exception as e:  # noqa: BLE001
            errors.append(e)
        finally:
            connection.close()

    threads = [threading.Thread(target=work) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert StockBalance.objects.get(ingredient=ing).qty == D("20")
    assert sorted(StockMovement.objects.values_list("balance_after", flat=True)) == [
        D(i) for i in range(1, 21)
    ]


def test_adjustment_overflowing_balance_is_rejected_not_500(admin_c):
    a = new_ing(admin_c, "A", "g")
    big = {"ingredient_id": a["id"], "mode": "delta", "qty_delta": "99999999999.999", "reason": "t"}
    assert admin_c.post("/api/v1/inventory/adjustments", big, format="json").status_code == 201
    r = admin_c.post("/api/v1/inventory/adjustments", big, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert balance(a["id"]) == D("99999999999.999") and StockMovement.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_opening_balances_apply_once(org, admin):
    ing = Ingredient.objects.create(organization=org, name="Beans", base_unit="g")
    StockBalance.objects.create(organization=org, ingredient=ing, location=default_location(org))
    statuses, barrier = [], threading.Barrier(2)

    def work():
        try:
            c = client_for(admin)
            barrier.wait()
            r = c.post(
                "/api/v1/inventory/opening-balances",
                {"items": [{"ingredient_id": str(ing.id), "qty": "100.000"}]},
                format="json",
            )
            statuses.append(r.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=work) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(statuses) == [201, 409]
    assert StockBalance.objects.get(ingredient=ing).qty == D("100")
    assert StockMovement.objects.filter(ingredient=ing).count() == 1
