"""Suppliers and purchases (spec 8.7). A draft is freely editable; posting is irreversible and
idempotent. Post lock order: poster's shift (drawer purchases) -> purchase row -> stock balances."""

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_avg, q_cost, q_money, q_qty
from apps.core.sequences import next_number
from apps.expenses.models import Expense
from apps.expenses.services import create_purchase_expense, void_purchase_expense
from apps.inventory.models import Ingredient, StockBalance, StockMovement
from apps.inventory.services import average_after_purchase, average_after_void, lock_balances
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
        "receipt_no": p.receipt_no,
        "supplier_invoice_no": p.supplier_invoice_no,
        "purchased_on": p.purchased_on.isoformat(),
        "status": p.status,
        "payment_method": p.payment_method,
        "source": p.source,
        "notes": p.notes,
        "total": str(p.total),
        "on_credit": p.on_credit,
        "amount_paid": str(p.amount_paid),
        "owed": str(owed(p)),
        "posted_at": _ts(p.posted_at),
        "posted_by": _user(p.posted_by),
        "created_by": _user(p.created_by),
        "void_reason": p.void_reason,
        "voided_at": _ts(p.voided_at),
        "voided_by": _user(p.voided_by),
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
                "pack_cost": None if i.pack_cost is None else str(i.pack_cost),
            }
            for i in p.items.all()
        ],
    }


def owed(p):
    """What is still owed to the supplier for this purchase (credit purchases only)."""
    if p.on_credit and p.status == Purchase.Status.POSTED:
        return p.total - p.amount_paid
    return q_money(0)


def get_purchase(org, pk, lock=False):
    qs = Purchase.objects.filter(organization=org)
    p = (qs.select_for_update() if lock else qs).filter(pk=pk).first()
    if p is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return p


def detail(org, pk) -> Purchase:
    return (
        Purchase.objects.filter(organization=org, pk=pk)
        .select_related("supplier", "posted_by", "created_by", "voided_by")
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
        qty, pack_cost = q_qty(i["qty"]), i.get("pack_cost")
        if pack_cost is not None:  # what was typed is what is paid: packs x pack price, exactly
            pack_cost = q_cost(pack_cost)
            line = q_money(i["pack_count"] * pack_cost)
            cost = q_cost(pack_cost / i["pack_size"])  # shown only; the line total is the truth
        else:  # what was paid for the whole line; the cost per unit is worked out (L4)
            line = q_money(i["line_total"])
            cost = q_cost(line / qty)  # shown only; item_cost() uses the exact line total
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
                pack_cost=pack_cost,
            )
        )
    PurchaseItem.objects.bulk_create(rows)
    return total


def _check_source(source, method):
    if source == Purchase.Source.CASH_DRAWER and method != Purchase.Method.CASH:
        raise _bad("payment_method", "A drawer purchase is paid in cash.")


_FIELDS = ("supplier_invoice_no", "purchased_on", "payment_method", "source", "notes", "on_credit")


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


def item_cost(item):
    """Exact cost per base unit of a purchase line: its money total over its quantity, so the
    stock value of a purchase equals what was paid (no 4-dp unit cost rounding)."""
    return q_avg(item.line_total / item.qty)


def post_purchase(actor, pk, key) -> tuple[int, dict]:
    """Runs inside the idempotency wrapper's transaction."""
    org = actor.organization
    seen = get_purchase(org, pk)
    shift = None
    if seen.on_credit:  # Sprint 5 P4: owed to someone, so the supplier is required
        if seen.supplier_id is None:
            raise _bad("supplier_id", "A purchase on credit needs its supplier.")
    elif seen.source == Purchase.Source.CASH_DRAWER:  # the poster's own open shift, even Admin
        shift = shift_services.lock_open_shift(actor)
        if shift is None:
            raise ApiError("SHIFT_NOT_OPEN", "Open your shift to pay from the drawer.", 409)
    p = get_purchase(org, pk, lock=True)
    if p.status == Purchase.Status.POSTED:
        raise ApiError("PURCHASE_ALREADY_POSTED", "This purchase is already posted.", 409)
    if (p.on_credit, p.source, p.supplier_id) != (seen.on_credit, seen.source, seen.supplier_id):
        # A draft edit slipped in between the unlocked read and the lock: the shift lock and the
        # supplier check above were decided on stale values. Nothing is written; reload and retry.
        raise ApiError(
            "PURCHASE_CHANGED",
            "This purchase was changed while posting. Reload it and post again.",
            409,
        )
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
        cost = item_cost(item)
        bal.avg_cost = average_after_purchase(bal, item.qty, cost)
        bal.qty = q_qty(bal.qty + item.qty)
        bal.save(update_fields=["qty", "avg_cost", "updated_at"])
        mv = StockMovement.objects.create(
            organization=org,
            ingredient_id=item.ingredient_id,
            location=bal.location,
            qty_delta=item.qty,
            movement_type=StockMovement.Type.PURCHASE,
            source_type=StockMovement.Source.PURCHASE_ITEM,
            source_id=item.pk,
            balance_after=bal.qty,
            unit_cost=cost,
            created_by=actor,
            occurred_at=now,
        )
        movement_ids.append(str(mv.pk))
    p.receipt_no = (
        f"PUR-{next_number(org.pk, 'purchase'):05d}"  # D22: gapless, rolls back with a failed post
    )
    # Paid now: one expense, today. On credit: no money goes out until a supplier payment.
    expense = None if p.on_credit else create_purchase_expense(actor, p, shift)
    p.status, p.posted_at, p.posted_by = Purchase.Status.POSTED, now, actor
    p.save()
    record(
        actor,
        "purchase.posted",
        p,
        {
            "receipt_no": p.receipt_no,
            "total": str(p.total),
            "items": len(items),
            "source": p.source,
            "payment_method": p.payment_method,
            "on_credit": p.on_credit,
            "expense_id": str(expense.pk) if expense else None,
            "shift_id": str(shift.pk) if shift else None,
        },
    )
    # Spec 9.4: the purchase fields plus the ids of what the post created.
    body = purchase_dict(detail(org, p.pk))
    return 200, {
        **body,
        "stock_movement_ids": movement_ids,
        "expense_id": str(expense.pk) if expense else None,
    }


@transaction.atomic
def void_purchase(actor, pk, reason) -> Purchase:
    """Admin, reason required (owner, 2026-11-16). Takes the purchased stock back out (it may go
    below zero if some was already used), takes the purchase out of the average cost, and voids
    its expense. A drawer purchase of a closed shift is refused: that shift's numbers are frozen.
    Lock order, as a close: the expense's shift -> purchase row -> stock balances."""
    org = actor.organization
    seen = get_purchase(org, pk)
    exp = Expense.objects.filter(purchase=seen).select_related("shift").first()
    if exp and exp.shift_id:
        from apps.shifts.models import CashierShift

        shift = CashierShift.objects.select_for_update().get(pk=exp.shift_id)
        if shift.status == CashierShift.Status.CLOSED:
            raise ApiError(
                "PURCHASE_NOT_VOIDABLE",
                "This purchase was paid from a shift that is already closed.",
                422,
                {"why": "shift_closed"},
            )
    p = get_purchase(org, pk, lock=True)
    if p.status == Purchase.Status.DRAFT:
        raise ApiError(
            "PURCHASE_NOT_VOIDABLE", "A draft is deleted, not voided.", 422, {"why": "draft"}
        )
    if p.status == Purchase.Status.VOIDED:
        raise ApiError(
            "PURCHASE_NOT_VOIDABLE", "This purchase is already voided.", 409, {"why": "voided"}
        )
    if p.amount_paid > 0:  # Sprint 5 P4: void its supplier payments first
        raise ApiError(
            "PURCHASE_NOT_VOIDABLE",
            "This purchase has supplier payments. Void them first.",
            409,
            {"why": "has_payments"},
        )
    items = list(p.items.all())
    balances = lock_balances(org, sorted({i.ingredient_id for i in items}))
    now, after = timezone.now(), {}
    for item in items:
        bal = balances[item.ingredient_id]
        cost = item_cost(item)
        bal.avg_cost = average_after_void(bal, item.qty, cost)
        bal.qty = q_qty(bal.qty - item.qty)
        bal.save(update_fields=["qty", "avg_cost", "updated_at"])
        StockMovement.objects.create(
            organization=org,
            ingredient_id=item.ingredient_id,
            location=bal.location,
            qty_delta=-item.qty,
            movement_type=StockMovement.Type.PURCHASE_VOID,
            source_type=StockMovement.Source.PURCHASE_VOID,
            source_id=item.pk,
            balance_after=bal.qty,
            unit_cost=cost,
            created_by=actor,
            occurred_at=now,
        )
        after[str(item.ingredient_id)] = str(bal.qty)
    if exp:
        void_purchase_expense(actor, exp, reason)
    p.status, p.void_reason, p.voided_at, p.voided_by = Purchase.Status.VOIDED, reason, now, actor
    p.save()
    record(
        actor,
        "purchase.voided",
        p,
        {
            "total": str(p.total),
            "items": len(items),
            "source": p.source,
            "reason": reason,
            "expense_id": str(exp.pk) if exp else None,
            "balances_after": after,
        },
    )
    return detail(org, p.pk)
