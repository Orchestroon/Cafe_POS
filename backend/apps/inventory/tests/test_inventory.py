import threading
import uuid
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


def opening(c, ing, qty, value, reason=None):
    body = {"items": [{"ingredient_id": ing["id"], "qty": qty, "total_value": value}]}
    if reason is not None:
        body["reason"] = reason
    return c.post("/api/v1/inventory/opening-balances", body, format="json")


def stock(c, ing, qty="100.000", value="100.00"):
    """Stock with a known cost (Sprint 5: the only way to add stock besides a purchase)."""
    assert opening(c, ing, qty, value).status_code == 201


def test_ingredient_creates_zero_balance_in_default_location(admin_c, org):
    ing = new_ing(admin_c, low_stock_threshold="500.000")
    b = StockBalance.objects.get(ingredient_id=ing["id"])
    assert b.qty == 0 and b.location.is_default and b.location.organization == org
    assert ing["low_stock_threshold"] == "500.000"
    assert ing["stock_qty"] == "0.000" and ing["avg_cost"] is None


def test_cost_is_never_typed_on_the_ingredient(admin_c):
    """Sprint 5 L1: the cost comes only from an opening balance with its value or a purchase."""
    r = admin_c.post(
        "/api/v1/ingredients",
        {"name": "X", "base_unit": "g", "reference_unit_cost": "1.0000"},
        format="json",
    )
    assert r.status_code == 400
    ing = new_ing(admin_c)
    for field in ("reference_unit_cost", "avg_cost", "stock_qty"):
        r = admin_c.patch(f"/api/v1/ingredients/{ing['id']}", {field: "1"}, format="json")
        assert r.status_code == 400
    stock(admin_c, ing, "2000.000", "300.00")
    got = data(admin_c.get(f"/api/v1/ingredients/{ing['id']}"))
    assert got["stock_qty"] == "2000.000" and got["avg_cost"] == "0.150000"


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
                {"ingredient_id": a["id"], "qty": "5000.000", "total_value": "4000.00"},
                {"ingredient_id": b["id"], "qty": "100.000", "total_value": "150.00"},
            ]
        },
        format="json",
    )
    assert r.status_code == 201
    assert balance(a["id"]) == D("5000") and balance(b["id"]) == D("100")
    m = StockMovement.objects.get(ingredient_id=a["id"])
    assert (m.movement_type, m.source_type, m.qty_delta, m.balance_after, m.unit_cost) == (
        "opening_balance",
        "stock_adjustment",
        D("5000"),
        D("5000"),
        D("0.8"),
    )
    assert StockBalance.objects.get(ingredient_id=a["id"]).avg_cost == D("0.8")
    assert StockAdjustment.objects.get(ingredient_id=b["id"]).total_value == D("150")
    ev = AuditEvent.objects.filter(action="stock.opening_balance").order_by("created_at")
    assert ev.count() == 2 and {e.summary["total_value"] for e in ev} == {"4000.00", "150.00"}


def test_later_opening_balance_needs_a_reason_and_is_weighted_in(admin_c):
    """Sprint 5 Q-E: stock that appears after the start (a gift, found in storage) comes in as
    an opening balance with its value and a reason; it is weighted into the average."""
    a, b = new_ing(admin_c, "A", "g"), new_ing(admin_c, "B", "g")
    stock(admin_c, a, "1000.000", "1000.00")  # 1.00/g
    r = admin_c.post(
        "/api/v1/inventory/opening-balances",
        {
            "items": [
                {"ingredient_id": b["id"], "qty": "50.000", "total_value": "5.00"},
                {"ingredient_id": a["id"], "qty": "1000.000", "total_value": "500.00"},
            ]
        },
        format="json",
    )
    assert r.status_code == 400 and "reason" in r.json()["error"]["details"]["fields"]
    assert balance(b["id"]) == 0  # nothing partially applied
    assert StockMovement.objects.count() == 1
    r = opening(admin_c, a, "1000.000", "500.00", reason="Gift from the roaster")
    assert r.status_code == 201
    bal = StockBalance.objects.get(ingredient_id=a["id"])
    assert bal.qty == D("2000") and bal.avg_cost == D("0.75")  # (1000 + 500) / 2000
    adj = StockAdjustment.objects.filter(ingredient_id=a["id"]).latest("created_at")
    assert adj.reason == "Gift from the roaster" and adj.total_value == D("500")


@pytest.mark.parametrize("value", [None, "0.00", "-1.00", 5, "1.001"])
def test_opening_balance_needs_a_value(admin_c, value):
    a = new_ing(admin_c, "A", "g")
    item = {"ingredient_id": a["id"], "qty": "10.000"}
    if value is not None:
        item["total_value"] = value
    r = admin_c.post("/api/v1/inventory/opening-balances", {"items": [item]}, format="json")
    assert r.status_code == 400 and not StockMovement.objects.exists()


@pytest.mark.parametrize(
    "items",
    [
        [],
        [
            {
                "ingredient_id": "00000000-0000-0000-0000-000000000000",
                "qty": "1.000",
                "total_value": "1.00",
            }
        ],
    ],
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
            {"items": [{"ingredient_id": a["id"], "qty": qty, "total_value": "1.00"}]},
            format="json",
        )
        assert r.status_code == 400
    dup = {"items": [{"ingredient_id": a["id"], "qty": "1.000", "total_value": "1.00"}] * 2}
    assert admin_c.post("/api/v1/inventory/opening-balances", dup, format="json").status_code == 400


def adjust(c, ing, **kw):
    return c.post(
        "/api/v1/inventory/adjustments", {"ingredient_id": ing["id"], **kw}, format="json"
    )


def test_adjustment_requires_reason(admin_c):
    a = new_ing(admin_c)
    stock(admin_c, a)
    for bad in ({}, {"reason": ""}, {"reason": "   "}):
        assert adjust(admin_c, a, mode="delta", qty_delta="-5.000", **bad).status_code == 400
        assert adjust(admin_c, a, mode="count", counted_qty="5.000", **bad).status_code == 400
    assert (
        balance(a["id"]) == D("100")
        and not StockAdjustment.objects.exclude(kind="opening_balance").exists()
    )


def test_delta_adjustment_only_takes_stock_out(admin_c):
    """Sprint 5 L2: stock is never added by hand (it was bought, or already in the café)."""
    a = new_ing(admin_c)
    stock(admin_c, a, "250.500", "250.50")
    r = adjust(admin_c, a, mode="delta", qty_delta="250.500", reason="Delivery")
    assert r.status_code == 400 and "qty_delta" in r.json()["error"]["details"]["fields"]
    r = adjust(admin_c, a, mode="delta", qty_delta="-50.000", reason="Spill")
    assert r.status_code == 201 and data(r)["balance_after"] == "200.500"
    ms = list(
        StockMovement.objects.order_by("created_at").values_list(
            "qty_delta", "balance_after", "movement_type", "unit_cost"
        )
    )
    assert ms == [
        (D("250.5"), D("250.5"), "opening_balance", D("1")),
        (D("-50"), D("200.5"), "adjustment", D("1")),
    ]
    ev = AuditEvent.objects.filter(action="stock.adjusted").latest("created_at")
    assert ev.summary["reason"] == "Spill" and ev.summary["balance_before"] == "250.500"


def test_adjustment_and_count_need_a_known_cost(admin_c):
    """Every movement has a value: an ingredient never stocked with a cost cannot be adjusted."""
    a = new_ing(admin_c)
    for kw in ({"mode": "delta", "qty_delta": "-1.000"}, {"mode": "count", "counted_qty": "5"}):
        r = adjust(admin_c, a, reason="x", **kw)
        assert r.status_code == 422 and r.json()["error"]["code"] == "COST_MISSING"
        assert r.json()["error"]["details"]["ingredients"] == ["Milk"]
    assert not StockMovement.objects.exists() and not StockAdjustment.objects.exists()


def test_balance_may_go_negative(admin_c):
    a = new_ing(admin_c)
    stock(admin_c, a, "1.000", "1.00")
    adjust(admin_c, a, mode="delta", qty_delta="-6.000", reason="Waste")
    assert balance(a["id"]) == D("-5")
    assert (
        data(admin_c.get("/api/v1/inventory/balances?is_negative=true"))[0]["is_negative"] is True
    )


def test_count_computes_delta_from_current_balance(admin_c):
    a = new_ing(admin_c)
    stock(admin_c, a, "100.000", "100.00")
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
    stock(admin_c, a, "40.000", "40.00")
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
        {"mode": "delta", "qty_delta": "-1.000", "counted_qty": "1.000"},
        {"mode": "delta", "qty_delta": "1.000"},
        {"mode": "count"},
        {"mode": "count", "counted_qty": "-1.000"},
        {"mode": "count", "counted_qty": "1", "qty_delta": "1"},
        {"mode": "other", "qty_delta": "1.000"},
        {"mode": "delta", "qty_delta": "-1.0001"},
    ],
)
def test_adjustment_validation(admin_c, payload):
    a = new_ing(admin_c)
    stock(admin_c, a)
    assert adjust(admin_c, a, reason="because", **payload).status_code == 400
    assert StockMovement.objects.count() == 1


def test_adjustment_unknown_ingredient_404(admin_c):
    r = admin_c.post(
        "/api/v1/inventory/adjustments",
        {
            "ingredient_id": "00000000-0000-0000-0000-000000000000",
            "mode": "delta",
            "qty_delta": "-1.000",
            "reason": "x",
        },
        format="json",
    )
    assert r.status_code == 404


def test_movements_are_append_only(admin_c, admin):
    a = new_ing(admin_c)
    stock(admin_c, a, "10.000", "10.00")
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
    stock(admin_c, low, "50.000", "5.00")
    stock(admin_c, ok, "500.000", "50.00")

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
    assert mv("?movement_type=opening_balance") == 2
    assert mv("?from=2000-01-01&to=2000-01-02") == 0 and mv("?from=2000-01-01") == 2
    assert admin_c.get("/api/v1/inventory/movements?from=bad").status_code == 400


def test_movement_date_filter_uses_org_timezone(admin_c, org):
    from datetime import UTC, datetime

    a = new_ing(admin_c)
    stock(admin_c, a, "1.000", "1.00")
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
    StockBalance.objects.create(
        organization=org,
        ingredient=ing,
        location=default_location(org),
        qty="100.000",
        avg_cost="1.000000",
    )
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
                        "qty_delta": "-1.000",
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
    assert StockBalance.objects.get(ingredient=ing).qty == D("80")
    assert sorted(StockMovement.objects.values_list("balance_after", flat=True)) == [
        D(i) for i in range(80, 100)
    ]


def test_adjustment_overflowing_balance_is_rejected_not_500(admin_c):
    a = new_ing(admin_c, "A", "g")
    stock(admin_c, a, "1.000", "1.00")
    big = {
        "ingredient_id": a["id"],
        "mode": "delta",
        "qty_delta": "-99999999999.999",
        "reason": "t",
    }
    assert admin_c.post("/api/v1/inventory/adjustments", big, format="json").status_code == 201
    r = admin_c.post("/api/v1/inventory/adjustments", big, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert balance(a["id"]) == D("-99999999998.999") and StockMovement.objects.count() == 2


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
                {"items": [{"ingredient_id": str(ing.id), "qty": "100.000", "total_value": "10"}]},
                format="json",
            )
            statuses.append(r.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=work) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    # The second one waits for the row lock, then sees stock already there and needs a reason.
    assert sorted(statuses) == [201, 400]
    assert StockBalance.objects.get(ingredient=ing).qty == D("100")
    assert StockMovement.objects.filter(ingredient=ing).count() == 1


@pytest.mark.parametrize(
    ("qty", "value"), [("0.000", "5.00"), ("5.000", "0.00"), ("5.000", "-1.00")]
)
def test_the_opening_service_itself_refuses_stock_without_a_cost(admin, admin_c, qty, value):
    """Step 1: the rule holds for any caller of the service, not only the API serializer."""
    from apps.core.exceptions import ApiError
    from apps.inventory.services import set_opening_balances

    a = new_ing(admin_c, "A", "g")
    item = {"ingredient_id": uuid.UUID(a["id"]), "qty": D(qty), "total_value": D(value)}
    with pytest.raises(ApiError) as e:
        set_opening_balances(admin, [item])
    assert e.value.code == "VALIDATION_ERROR" and not StockMovement.objects.exists()


@pytest.mark.parametrize(("qty", "value"), [("5.000", None), ("5.000", "0.00"), ("0.000", "5.00")])
def test_the_database_refuses_an_opening_balance_without_a_value(admin, admin_c, qty, value):
    """Step 1: the last line of defence, below the serializer and the service."""
    from django.db import IntegrityError, transaction

    a = new_ing(admin_c, "A", "g")
    bal = StockBalance.objects.get(ingredient_id=a["id"])
    with pytest.raises(IntegrityError), transaction.atomic():
        StockAdjustment.objects.create(
            organization=admin.organization,
            ingredient_id=a["id"],
            location=bal.location,
            kind=StockAdjustment.Kind.OPENING,
            qty_delta=D(qty),
            total_value=None if value is None else D(value),
            reason="Opening balance",
            created_by=admin,
        )
    assert not StockAdjustment.objects.exists()
