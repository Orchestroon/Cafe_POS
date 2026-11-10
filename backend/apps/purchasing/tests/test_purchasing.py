import threading
import uuid
from decimal import Decimal

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.core.models import IdempotencyRecord
from apps.expenses.models import Expense
from apps.inventory.models import StockMovement
from apps.purchasing.models import Purchase
from apps.sales.tests.conftest import balance, close_shift, open_shift
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db


def milk_item(shop, **over):
    return {
        "ingredient_id": str(shop.ing["Whole Milk"].pk),
        "pack_label": "1 L bottle",
        "pack_count": "12.000",
        "pack_size": "1000.000",
        "unit_cost": "0.0300",
        **over,
    }


def draft(c, shop, items=None, **over):
    body = {
        "purchased_on": "2026-11-10",
        "items": items if items is not None else [milk_item(shop)],
        **over,
    }
    return c.post("/api/v1/purchases", body, format="json")


def post_it(c, pid, key=None):
    return c.post(
        f"/api/v1/purchases/{pid}/post",
        {},
        format="json",
        headers={"Idempotency-Key": str(key or uuid.uuid4())},
    )


# ---- suppliers ----------------------------------------------------------------------------------


def test_supplier_crud_audit_and_unique_name(admin_c):
    r = admin_c.post("/api/v1/suppliers", {"name": "Dairy Co", "phone": "010"}, format="json")
    assert (
        r.status_code == 201 and AuditEvent.objects.filter(action="supplier.created").count() == 1
    )
    sid = data(r)["id"]
    assert admin_c.post("/api/v1/suppliers", {"name": "dairy co"}, format="json").status_code == 400
    r = admin_c.patch(f"/api/v1/suppliers/{sid}", {"is_active": False}, format="json")
    assert r.status_code == 200 and data(r)["is_active"] is False
    assert AuditEvent.objects.filter(action="supplier.updated").count() == 1
    assert admin_c.get("/api/v1/suppliers?is_active=false").json()["meta"]["total_count"] == 1


def test_suppliers_are_tenant_scoped(admin_c, admin2_c):
    sid = data(admin_c.post("/api/v1/suppliers", {"name": "Dairy Co"}, format="json"))["id"]
    assert admin2_c.get("/api/v1/suppliers").json()["meta"]["total_count"] == 0
    assert (
        admin2_c.patch(f"/api/v1/suppliers/{sid}", {"phone": "1"}, format="json").status_code == 404
    )
    # the same name is free in another café
    assert (
        admin2_c.post("/api/v1/suppliers", {"name": "Dairy Co"}, format="json").status_code == 201
    )


# ---- drafts -------------------------------------------------------------------------------------


def test_draft_with_pack_helper_computes_qty_and_totals(admin_c, shop):
    r = draft(admin_c, shop, supplier_invoice_no="INV-1", notes="weekly")
    assert r.status_code == 201, r.content
    d = data(r)
    it = d["items"][0]
    assert d["status"] == "draft" and d["source"] == "external" and d["payment_method"] == "cash"
    assert (it["qty"], it["unit_cost"], it["line_total"]) == ("12000.000", "0.0300", "360.00")
    assert d["total"] == "360.00" and it["pack_count"] == "12.000" and it["unit"] == "ml"
    assert balance(shop.ing["Whole Milk"]) == Decimal("5000.000")  # a draft moves no stock
    assert Expense.objects.count() == 0


def test_draft_with_plain_qty_and_rounded_line_total(admin_c, shop):
    item = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "3.000", "unit_cost": "0.3333"}
    d = data(draft(admin_c, shop, [item]))
    assert d["items"][0]["line_total"] == "1.00" and d["total"] == "1.00"


def test_draft_is_editable_and_deletable(admin_c, shop):
    pid = data(draft(admin_c, shop))["id"]
    cup = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "50.000", "unit_cost": "0.2000"}
    r = admin_c.patch(f"/api/v1/purchases/{pid}", {"items": [cup], "notes": "x"}, format="json")
    assert r.status_code == 200 and data(r)["total"] == "10.00" and len(data(r)["items"]) == 1
    assert data(admin_c.get(f"/api/v1/purchases/{pid}"))["notes"] == "x"
    assert admin_c.delete(f"/api/v1/purchases/{pid}").status_code == 204
    assert (
        Purchase.objects.count() == 0
        and AuditEvent.objects.filter(action="purchase.deleted").count() == 1
    )


@pytest.mark.parametrize(
    "item_over",
    [
        {"qty": "5.000"},  # contradicts pack_count x pack_size
        {"pack_size": None},  # pack fields go together
        {"unit_cost": "-1.0000"},
        {"pack_count": "0.000"},
        {"ingredient_id": str(uuid.uuid4())},
    ],
)
def test_draft_validation(admin_c, shop, item_over):
    r = draft(admin_c, shop, [milk_item(shop, **item_over)])
    assert r.status_code == 400 and Purchase.objects.count() == 0


def test_draft_needs_qty_or_pack(admin_c, shop):
    item = {"ingredient_id": str(shop.ing["Cup"].pk), "unit_cost": "1.0000"}
    assert draft(admin_c, shop, [item]).status_code == 400


def test_drawer_purchase_must_be_cash_and_supplier_must_exist(admin_c, shop):
    assert draft(admin_c, shop, source="cash_drawer", payment_method="card").status_code == 400
    assert draft(admin_c, shop, supplier_id=str(uuid.uuid4())).status_code == 400
    assert draft(admin_c, shop, source="cash_drawer", payment_method="cash").status_code == 201


def test_other_orgs_ingredient_and_supplier_are_rejected(admin2_c, admin_c, shop):
    sid = data(admin_c.post("/api/v1/suppliers", {"name": "S"}, format="json"))["id"]
    assert draft(admin2_c, shop).status_code == 400  # milk belongs to the first café
    r = admin2_c.post(
        "/api/v1/purchases",
        {"purchased_on": "2026-11-10", "supplier_id": sid, "items": []},
        format="json",
    )
    assert r.status_code == 400


def test_purchases_are_tenant_scoped(admin_c, admin2_c, shop):
    pid = data(draft(admin_c, shop))["id"]
    assert admin2_c.get("/api/v1/purchases").json()["meta"]["total_count"] == 0
    assert admin2_c.get(f"/api/v1/purchases/{pid}").status_code == 404
    assert (
        admin2_c.patch(f"/api/v1/purchases/{pid}", {"notes": "x"}, format="json").status_code == 404
    )
    assert admin2_c.delete(f"/api/v1/purchases/{pid}").status_code == 404
    assert post_it(admin2_c, pid).status_code == 404
    assert Purchase.objects.get().status == "draft"


def test_list_filters(admin_c, shop):
    pid = data(draft(admin_c, shop))["id"]
    draft(admin_c, shop, purchased_on="2026-10-01")
    post_it(admin_c, pid)
    assert admin_c.get("/api/v1/purchases?status=posted").json()["meta"]["total_count"] == 1
    assert admin_c.get("/api/v1/purchases?from=2026-11-01").json()["meta"]["total_count"] == 1


# ---- posting ------------------------------------------------------------------------------------


def test_at16_post_twice_adds_stock_and_cost_once(admin_c, admin, shop):
    pid = data(draft(admin_c, shop))["id"]
    key = uuid.uuid4()
    first = post_it(admin_c, pid, key)
    assert first.status_code == 200, first.content
    again = post_it(admin_c, pid, key)
    assert again.status_code == 200 and again["Idempotent-Replayed"] == "true"
    assert again.json() == first.json()
    assert balance(shop.ing["Whole Milk"]) == Decimal("17000.000")  # 5000 + 12000, once
    exp = Expense.objects.get()
    assert (exp.type, exp.category, str(exp.amount), exp.source) == (
        "purchase",
        "purchase",
        "360.00",
        "external",
    )
    assert exp.shift is None and exp.purchase_id == uuid.UUID(pid)
    mv = StockMovement.objects.get(movement_type="purchase")
    assert mv.qty_delta == Decimal("12000.000") and mv.balance_after == Decimal("17000.000")
    assert mv.source_type == "purchase_item" and mv.created_by == admin
    d = data(first)
    assert d["status"] == "posted" and d["posted_by"]["id"] == str(admin.pk) and d["posted_at"]
    # spec 9.4: the ids of what the post created
    assert d["stock_movement_ids"] == [str(mv.pk)] and d["expense_id"] == str(exp.pk)
    assert AuditEvent.objects.filter(action="purchase.posted").count() == 1
    other = post_it(admin_c, pid)  # a different key
    assert other.status_code == 409 and other.json()["error"]["code"] == "PURCHASE_ALREADY_POSTED"
    assert (
        Expense.objects.count() == 1
        and StockMovement.objects.filter(movement_type="purchase").count() == 1
    )
    assert balance(shop.ing["Whole Milk"]) == Decimal("17000.000")


def test_a_posted_purchase_is_not_editable_or_deletable(admin_c, shop):
    pid = data(draft(admin_c, shop))["id"]
    post_it(admin_c, pid)
    for r in (
        admin_c.patch(f"/api/v1/purchases/{pid}", {"notes": "x"}, format="json"),
        admin_c.delete(f"/api/v1/purchases/{pid}"),
    ):
        assert r.status_code == 409 and r.json()["error"]["code"] == "PURCHASE_NOT_EDITABLE"
    assert Purchase.objects.get().notes == ""


def test_post_needs_an_item_a_positive_total_and_a_key(admin_c, shop):
    empty = data(draft(admin_c, shop, []))["id"]
    r = post_it(admin_c, empty)
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    free = data(draft(admin_c, shop, [milk_item(shop, unit_cost="0.0000")]))["id"]
    assert post_it(admin_c, free).status_code == 400
    r = admin_c.post(f"/api/v1/purchases/{free}/post", {}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
    assert (
        Expense.objects.count() == 0
        and StockMovement.objects.filter(movement_type="purchase").count() == 0
    )
    assert IdempotencyRecord.objects.filter(scope__startswith="purchase_post").count() == 0


def test_the_same_ingredient_on_two_lines_accumulates(admin_c, shop):
    a = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "10.000", "unit_cost": "1.0000"}
    b = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "5.000", "unit_cost": "2.0000"}
    pid = data(draft(admin_c, shop, [a, b]))["id"]
    assert post_it(admin_c, pid).status_code == 200
    assert balance(shop.ing["Cup"]) == Decimal("115.000")
    assert list(
        StockMovement.objects.filter(movement_type="purchase")
        .order_by("balance_after")
        .values_list("balance_after", flat=True)
    ) == [
        Decimal("110.000"),
        Decimal("115.000"),
    ]


def test_drawer_purchase_needs_the_posters_own_open_shift_even_for_an_admin(admin_c, shop):
    pid = data(draft(admin_c, shop, source="cash_drawer"))["id"]
    r = post_it(admin_c, pid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    assert Purchase.objects.get().status == "draft" and balance(shop.ing["Whole Milk"]) == Decimal(
        "5000.000"
    )
    s = open_shift(admin_c, "1000.00")
    assert post_it(admin_c, pid).status_code == 200
    assert str(Expense.objects.get().shift_id) == s["id"]
    cur = data(admin_c.get("/api/v1/shifts/current"))["totals"]
    assert cur["drawer_expenses"] == "360.00" and cur["expected_cash"] == "640.00"
    d = data(close_shift(admin_c, s["id"], "640.00"))
    assert d["expected_cash"] == "640.00"


def test_a_purchase_expense_cannot_be_voided(admin_c, shop):
    pid = data(draft(admin_c, shop))["id"]
    post_it(admin_c, pid)
    eid = Expense.objects.get().pk
    r = admin_c.post(f"/api/v1/expenses/{eid}/void", {"reason": "oops"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "EXPENSE_NOT_VOIDABLE"


@pytest.mark.django_db(transaction=True)
def test_racing_posts_with_different_keys_post_once(org, admin, shop):
    c = client_for(admin)
    pid = data(draft(c, shop))["id"]
    other = make_user(org, "admin_b", "admin")
    start, codes = threading.Barrier(2), []

    def go(user):
        try:
            cl = client_for(user)
            start.wait()
            codes.append(post_it(cl, pid).status_code)
        finally:
            connection.close()

    ts = [threading.Thread(target=go, args=(u,)) for u in (admin, other)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [200, 409]
    assert balance(shop.ing["Whole Milk"]) == Decimal("17000.000") and Expense.objects.count() == 1


@pytest.mark.parametrize(
    "item", [{}, {"qty": "1.000"}, {"ingredient_id": "x", "qty": "1.000", "unit_cost": "1.0000"}]
)
def test_patch_items_missing_fields_is_400_not_500(admin_c, shop, item):
    pid = data(draft(admin_c, shop))["id"]
    r = admin_c.patch(f"/api/v1/purchases/{pid}", {"items": [item]}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert len(data(admin_c.get(f"/api/v1/purchases/{pid}"))["items"]) == 1  # untouched


def test_post_creates_a_missing_balance_row_instead_of_a_500(admin_c, shop):
    from apps.inventory.models import StockBalance

    ing = shop.ing["Whole Milk"]
    StockBalance.objects.filter(ingredient=ing).delete()
    pid = data(draft(admin_c, shop))["id"]
    r = post_it(admin_c, pid)
    assert r.status_code == 200, r.content
    assert balance(ing) == Decimal("12000.000")
