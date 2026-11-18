import importlib
import threading
import uuid
from decimal import Decimal

import pytest
from django.apps import apps as django_apps
from django.db import connection

from apps.audit.models import AuditEvent
from apps.core.models import IdempotencyRecord
from apps.expenses.models import Expense
from apps.inventory.models import StockMovement
from apps.purchasing import services
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
        "pack_cost": "30.00",  # one 1 L bottle: 0.03 per ml
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


def test_quantity_and_total_paid_the_system_works_out_the_cost(admin_c, shop):
    """Sprint 5 L4 (owner, 2026-11-17): 500 kg for 785 -> 500,000 g; the line is exactly what
    was paid and the average uses it exactly (0.00157 per g), not a rounded unit cost."""
    coffee = shop.ing["Coffee Beans"]
    item = {"ingredient_id": str(coffee.pk), "qty": "500000.000", "line_total": "785.00"}
    d = data(draft(admin_c, shop, [item]))
    line = d["items"][0]
    assert (line["qty"], line["line_total"], d["total"]) == ("500000.000", "785.00", "785.00")
    assert line["unit_cost"] == "0.0016"  # shown only (4 decimals)
    assert post_it(admin_c, d["id"]).status_code == 200
    # (1000 g x 1.00 + 785.00) / 501,000 g
    from apps.inventory.models import StockBalance

    assert StockBalance.objects.get(ingredient=coffee).avg_cost == Decimal("0.003563")
    assert Expense.objects.get().amount == Decimal("785.00")


def test_draft_is_editable_and_deletable(admin_c, shop):
    pid = data(draft(admin_c, shop))["id"]
    cup = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "50.000", "line_total": "10.00"}
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
        {"pack_cost": "-1.00"},
        {"pack_cost": None},  # a pack line needs its price
        {"line_total": "10.00"},  # pack price or line total, not both
        {"pack_count": "0.000"},
        {"ingredient_id": str(uuid.uuid4())},
    ],
)
def test_draft_validation(admin_c, shop, item_over):
    r = draft(admin_c, shop, [milk_item(shop, **item_over)])
    assert r.status_code == 400 and Purchase.objects.count() == 0


@pytest.mark.parametrize(
    "item",
    [
        {"line_total": "1.00"},  # no quantity
        {"qty": "1.000"},  # no price
        {"qty": "1.000", "unit_cost": "1.0000"},  # the cost per unit is never typed (L4)
        {"qty": "1.000", "line_total": "-1.00"},
        {"qty": "1.000", "line_total": 5},
    ],
)
def test_draft_needs_quantity_and_total_or_pack(admin_c, shop, item):
    body = {"ingredient_id": str(shop.ing["Cup"].pk), **item}
    assert draft(admin_c, shop, [body]).status_code == 400


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
    free = data(draft(admin_c, shop, [milk_item(shop, pack_cost="0.00")]))["id"]
    assert post_it(admin_c, free).status_code == 400
    r = admin_c.post(f"/api/v1/purchases/{free}/post", {}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
    assert (
        Expense.objects.count() == 0
        and StockMovement.objects.filter(movement_type="purchase").count() == 0
    )
    assert IdempotencyRecord.objects.filter(scope__startswith="purchase_post").count() == 0


def test_the_same_ingredient_on_two_lines_accumulates(admin_c, shop):
    a = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "10.000", "line_total": "10.00"}
    b = {"ingredient_id": str(shop.ing["Cup"].pk), "qty": "5.000", "line_total": "10.00"}
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
    "item", [{}, {"qty": "1.000"}, {"ingredient_id": "x", "qty": "1.000", "line_total": "1.00"}]
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


@pytest.mark.parametrize(
    "edit",
    [
        {"source": "cash_drawer"},  # external -> drawer: would have posted with no shift locked
        {"on_credit": True},  # paid now -> credit with no supplier: an unpayable debt
    ],
)
def test_a_draft_edited_while_posting_is_a_409_and_writes_nothing(admin_c, shop, monkeypatch, edit):
    """The post decides the shift lock and the supplier check from an unlocked read; an edit that
    lands before the row lock must be refused, not posted on stale values (Step 1, point 2)."""
    pid = data(draft(admin_c, shop))["id"]
    before = balance(shop.ing["Whole Milk"])
    real, calls = services.get_purchase, []

    def racing(org, pk, lock=False):
        found = real(org, pk, lock)
        if not lock and not calls:  # the unlocked read; the edit commits right after it
            calls.append(1)
            Purchase.objects.filter(pk=pk).update(**edit)
        return found

    monkeypatch.setattr(services, "get_purchase", racing)
    r = post_it(admin_c, pid)
    assert r.status_code == 409 and r.json()["error"]["code"] == "PURCHASE_CHANGED"
    assert Purchase.objects.get().status == "draft"
    assert balance(shop.ing["Whole Milk"]) == before
    assert not StockMovement.objects.filter(movement_type="purchase").exists()
    assert not Expense.objects.exists() and not IdempotencyRecord.objects.exists()


def test_a_purchase_gets_its_own_number_when_posted_not_before(admin_c, shop):
    """D22: PUR-00001 at post (gapless, kept if voided); the supplier invoice stays optional."""
    a = data(draft(admin_c, shop))["id"]
    b = data(draft(admin_c, shop, supplier_invoice_no="INV-77"))["id"]
    assert data(admin_c.get(f"/api/v1/purchases/{a}"))["receipt_no"] == ""  # a draft: none yet
    first, second = data(post_it(admin_c, b)), data(post_it(admin_c, a))
    assert (first["receipt_no"], second["receipt_no"]) == ("PUR-00001", "PUR-00002")
    assert first["supplier_invoice_no"] == "INV-77" and second["supplier_invoice_no"] == ""
    assert Expense.objects.get(purchase_id=b).description == "Purchase PUR-00001"
    assert (
        AuditEvent.objects.get(action="purchase.posted", entity_id=b).summary["receipt_no"]
        == "PUR-00001"
    )
    admin_c.post(f"/api/v1/purchases/{b}/void", {"reason": "wrong"}, format="json")
    third = data(post_it(admin_c, data(draft(admin_c, shop))["id"]))
    assert third["receipt_no"] == "PUR-00003"  # a void does not give its number back
    assert data(admin_c.get(f"/api/v1/purchases/{b}"))["receipt_no"] == "PUR-00001"


def test_a_failed_post_does_not_use_up_a_purchase_number(admin_c, shop):
    pid = data(draft(admin_c, shop, source="cash_drawer"))["id"]
    assert post_it(admin_c, pid).status_code == 409  # no open shift
    assert not Purchase.objects.exclude(receipt_no="").exists()
    open_shift(admin_c, "1000.00")
    assert data(post_it(admin_c, pid))["receipt_no"] == "PUR-00001"  # no gap


def test_a_client_cannot_set_the_purchase_number(admin_c, shop):
    r = draft(admin_c, shop, receipt_no="PUR-99999")
    assert r.status_code == 400


def test_the_receipt_backfill_numbers_posted_and_voided_in_posting_order(admin_c, shop):
    from apps.core.models import Sequence

    ids = [data(draft(admin_c, shop))["id"] for _ in range(3)]
    for pid in ids[:2]:
        post_it(admin_c, pid)
    admin_c.post(f"/api/v1/purchases/{ids[0]}/void", {"reason": "wrong"}, format="json")
    Purchase.objects.update(receipt_no="")
    Sequence.objects.all().delete()
    importlib.import_module("apps.purchasing.migrations.0004_receipt_no").number_posted_purchases(
        django_apps, None
    )
    got = {str(p.pk): p.receipt_no for p in Purchase.objects.all()}
    assert got == {ids[0]: "PUR-00001", ids[1]: "PUR-00002", ids[2]: ""}  # the draft stays blank
    assert Sequence.objects.get(name="purchase").last_number == 2
