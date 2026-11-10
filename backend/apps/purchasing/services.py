"""Suppliers and purchases (spec 8.7). A draft is freely editable; posting is irreversible and
idempotent. Post lock order: poster's shift (drawer purchases) -> purchase row -> stock balances."""

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_cost, q_money, q_qty
from apps.expenses.services import create_purchase_expense
from apps.inventory.models import Ingredient, StockBalance, StockMovement
from apps.inventory.services import lock_balances
from apps.shifts import services as shift_services
from apps.tenancy.seed import default_location

from .models import Purchase, PurchaseItem, Supplier


def _bad(field, message):
    return ApiError("VALIDATION_ERROR", "Validation failed.", 400, {"fields": {field: message}})


def _ts(dt):
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def _user(u):
    return {"id": str(u.pk), "display_name": u.display_name or u.username} if u else None


def purchase_dict(p) -> dict:
    return {
        "id": str(p.pk),
        "supplier": {"id": str(p.supplier_id), "name": p.supplier.name} if p.supplier_id else None,
        "supplier_invoice_no": p.supplier_invoice_no,
        "purchased_on": p.purchased_on.isoformat(),
        "status": p.status,
        "payment_method": p.payment_method,
        "source": p.source,
        "notes": p.notes,
        "total": str(p.total),
        "posted_at": _ts(p.posted_at),
        "posted_by": _user(p.posted_by),
        "created_by": _user(p.created_by),
        "items": [
            {
                "id": str(i.pk),
                "ingredient_id": str(i.ingredient_id),
                "ingredient_name": i.ingredient.name,
                "unit": i.ingredient.base_unit,
                "qty": str(i.qty),
                "unit_cost": str(i.unit_cost),
                "line_total": str(i.line_total),
                "pack_label": i.pack_label,
                "pack_count": None if i.pack_count is None else str(i.pack_count),
                "pack_size": None if i.pack_size is None else str(i.pack_size),
            }
            for i in p.items.all()
        ],
    }


def get_purchase(org, pk, lock=False):
    qs = Purchase.objects.filter(organization=org)
    p = (qs.select_for_update() if lock else qs).filter(pk=pk).first()
    if p is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return p


def detail(org, pk) -> Purchase:
    return (
        Purchase.objects.filter(organization=org, pk=pk)
        .select_related("supplier", "posted_by", "created_by")
        .prefetch_related("items__ingredient")
        .get()
    )


def _check_supplier(org, supplier_id):
    if supplier_id is None:
        return None
    s = Supplier.objects.filter(organization=org, pk=supplier_id, is_active=True).first()
    if s is None:
        raise _bad("supplier_id", "Unknown or inactive supplier.")
    return s


def _build_items(org, purchase, items):
    ids = {i["ingredient_id"] for i in items}
    found = set(
        Ingredient.objects.filter(organization=org, pk__in=ids, is_active=True).values_list(
            "pk", flat=True
        )
    )
    if found != ids:
        raise _bad("items", "Unknown or inactive ingredient.")
    rows, total = [], q_money(0)
    for i in items:
        qty, cost = q_qty(i["qty"]), q_cost(i["unit_cost"])
        line = q_money(qty * cost)
        total += line
        rows.append(
            PurchaseItem(
                organization=org,
                purchase=purchase,
                ingredient_id=i["ingredient_id"],
                qty=qty,
                unit_cost=cost,
                line_total=line,
                pack_label=i.get("pack_label", ""),
                pack_count=i.get("pack_count"),
                pack_size=i.get("pack_size"),
            )
        )
    PurchaseItem.objects.bulk_create(rows)
    return total


def _check_source(source, method):
    if source == Purchase.Source.CASH_DRAWER and method != Purchase.Method.CASH:
        raise _bad("payment_method", "A drawer purchase is paid in cash.")


_FIELDS = ("supplier_invoice_no", "purchased_on", "payment_method", "source", "notes")


@transaction.atomic
def create_draft(actor, data) -> Purchase:
    org = actor.organization
    supplier = _check_supplier(org, data.get("supplier_id"))
    values = {f: data[f] for f in _FIELDS if f in data}
    p = Purchase(organization=org, supplier=supplier, created_by=actor, **values)
    _check_source(p.source, p.payment_method)
    p.save()
    p.total = _build_items(org, p, data["items"])
    p.save(update_fields=["total", "updated_at"])
    record(actor, "purchase.created", p, {"total": str(p.total), "items": len(data["items"])})
    return detail(org, p.pk)


@transaction.atomic
def update_draft(actor, pk, data) -> Purchase:
    org = actor.organization
    p = get_purchase(org, pk, lock=True)
    if p.status != Purchase.Status.DRAFT:
        raise ApiError("PURCHASE_NOT_EDITABLE", "A posted purchase cannot be edited.", 409)
    if "supplier_id" in data:
        p.supplier = _check_supplier(org, data["supplier_id"])
    for f in _FIELDS:
        if f in data:
            setattr(p, f, data[f])
    _check_source(p.source, p.payment_method)
    if "items" in data:
        p.items.all().delete()
        p.total = _build_items(org, p, data["items"])
    p.save()
    record(actor, "purchase.updated", p, {"total": str(p.total), "fields": sorted(data)})
    return detail(org, p.pk)


@transaction.atomic
def delete_draft(actor, pk) -> None:
    p = get_purchase(actor.organization, pk, lock=True)
    if p.status != Purchase.Status.DRAFT:
        raise ApiError("PURCHASE_NOT_EDITABLE", "A posted purchase cannot be deleted.", 409)
    record(actor, "purchase.deleted", p, {"total": str(p.total)})
    p.delete()  # items cascade; drafts have no stock or expense effect


def post_purchase(actor, pk, key) -> tuple[int, dict]:
    """Runs inside the idempotency wrapper's transaction."""
    org = actor.organization
    seen = get_purchase(org, pk)
    shift = None
    if seen.source == Purchase.Source.CASH_DRAWER:  # the poster's own open shift, even an Admin's
        shift = shift_services.lock_open_shift(actor)
        if shift is None:
            raise ApiError("SHIFT_NOT_OPEN", "Open your shift to pay from the drawer.", 409)
    p = get_purchase(org, pk, lock=True)
    if p.status == Purchase.Status.POSTED:
        raise ApiError("PURCHASE_ALREADY_POSTED", "This purchase is already posted.", 409)
    items = list(p.items.select_related("ingredient"))
    if not items:
        raise _bad("items", "A purchase needs at least one item.")
    if p.total <= 0:
        raise _bad("total", "The purchase total must be greater than zero.")
    ids = sorted({i.ingredient_id for i in items})
    balances = lock_balances(org, ids)
    for missing in set(ids) - set(balances):  # same safeguard as checkout: never a KeyError/500
        balances[missing] = StockBalance.objects.create(
            organization=org, ingredient_id=missing, location=default_location(org)
        )
    now = timezone.now()
    movement_ids = []
    for item in items:
        bal = balances[item.ingredient_id]
        bal.qty = q_qty(bal.qty + item.qty)
        bal.save(update_fields=["qty", "updated_at"])
        mv = StockMovement.objects.create(
            organization=org,
            ingredient_id=item.ingredient_id,
            location=bal.location,
            qty_delta=item.qty,
            movement_type=StockMovement.Type.PURCHASE,
            source_type=StockMovement.Source.PURCHASE_ITEM,
            source_id=item.pk,
            balance_after=bal.qty,
            created_by=actor,
            occurred_at=now,
        )
        movement_ids.append(str(mv.pk))
    expense = create_purchase_expense(actor, p, shift)
    p.status, p.posted_at, p.posted_by = Purchase.Status.POSTED, now, actor
    p.save()
    record(
        actor,
        "purchase.posted",
        p,
        {
            "total": str(p.total),
            "items": len(items),
            "source": p.source,
            "payment_method": p.payment_method,
            "expense_id": str(expense.pk),
            "shift_id": str(shift.pk) if shift else None,
        },
    )
    # Spec 9.4: the purchase fields plus the ids of what the post created.
    body = purchase_dict(detail(org, p.pk))
    return 200, {**body, "stock_movement_ids": movement_ids, "expense_id": str(expense.pk)}
