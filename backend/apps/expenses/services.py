from django.db import transaction
from django.utils import timezone

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.policy import has_perm
from apps.shifts import services as shift_services

from .models import Expense


def expense_dict(e) -> dict:
    ts = lambda dt: dt.isoformat().replace("+00:00", "Z") if dt else None  # noqa: E731
    return {
        "id": str(e.pk),
        "type": e.type,
        "category": e.category,
        "description": e.description,
        "amount": str(e.amount),
        "payment_method": e.payment_method,
        "source": e.source,
        "shift_id": str(e.shift_id) if e.shift_id else None,
        "purchase_id": str(e.purchase_id) if e.purchase_id else None,
        "paid_at": ts(e.paid_at),
        "status": e.status,
        "void_reason": e.void_reason,
        "voided_at": ts(e.voided_at),
        "created_by": {
            "id": str(e.created_by_id),
            "display_name": e.created_by.display_name or e.created_by.username,
        },
    }


def _audit_summary(e) -> dict:
    return {
        "type": e.type,
        "category": e.category,
        "description": e.description,
        "amount": str(e.amount),
        "payment_method": e.payment_method,
        "source": e.source,
        "shift_id": str(e.shift_id) if e.shift_id else None,
    }


@transaction.atomic
def create_expense(actor, data) -> Expense:
    """D10: a Barista's expense is forced onto their own open shift, paid in cash from the drawer.
    The shift row is locked so a concurrent close cannot miss the expense."""
    if has_perm(actor, "expenses.view_all"):
        source = data.get("source", Expense.Source.EXTERNAL)
        method = data.get("payment_method", Expense.Method.CASH)
    else:
        source, method = Expense.Source.CASH_DRAWER, Expense.Method.CASH
    shift = None
    if source == Expense.Source.CASH_DRAWER:
        if method != Expense.Method.CASH:
            raise ApiError(
                "VALIDATION_ERROR",
                "Validation failed.",
                400,
                {"fields": {"payment_method": "A drawer expense is paid in cash."}},
            )
        shift = shift_services.lock_open_shift(actor)
        if shift is None:
            raise ApiError("SHIFT_NOT_OPEN", "Open your shift to pay from the drawer.", 409)
    exp = Expense.objects.create(
        organization=actor.organization,
        type=Expense.Type.GENERAL,
        category=data["category"],
        description=data["description"].strip(),
        amount=data["amount"],
        payment_method=method,
        source=source,
        shift=shift,
        created_by=actor,
    )
    record(actor, "expense.created", exp, _audit_summary(exp))
    return exp


def create_purchase_expense(actor, purchase, shift) -> Expense:
    """Called by the purchase post (inside its transaction): the one expense of a purchase."""
    exp = Expense.objects.create(
        organization=actor.organization,
        type=Expense.Type.PURCHASE,
        category=Expense.Category.PURCHASE,
        description=f"Purchase {purchase.supplier_invoice_no}".strip() or "Purchase",
        amount=purchase.total,
        payment_method=purchase.payment_method,
        source=purchase.source,
        shift=shift,
        purchase=purchase,
        created_by=actor,
    )
    record(actor, "expense.created", exp, _audit_summary(exp))
    return exp


@transaction.atomic
def void_expense(actor, pk, reason) -> Expense:
    """Admin only. Lock order: the expense's shift (as a close takes it) -> the expense row.
    A purchase expense, an already voided one, or a drawer expense of a closed shift (its stored
    numbers are frozen) cannot be voided."""
    seen = Expense.objects.filter(organization=actor.organization, pk=pk).first()
    if seen is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if seen.shift_id:
        from apps.shifts.models import CashierShift

        CashierShift.objects.select_for_update().get(pk=seen.shift_id)
    exp = (
        Expense.objects.select_for_update(of=("self",))
        .select_related("shift", "created_by")
        .get(pk=pk)
    )

    def refuse(why):
        raise ApiError("EXPENSE_NOT_VOIDABLE", "This expense cannot be voided.", 422, {"why": why})

    if exp.type == Expense.Type.PURCHASE:
        refuse("purchase_expense")
    if exp.status == Expense.Status.VOIDED:
        refuse("already_voided")
    if exp.shift_id and exp.shift.status == "closed":
        refuse("shift_closed")
    exp.status, exp.void_reason = Expense.Status.VOIDED, reason
    exp.voided_by, exp.voided_at = actor, timezone.now()
    exp.save()
    record(actor, "expense.voided", exp, {**_audit_summary(exp), "reason": reason})
    return exp
