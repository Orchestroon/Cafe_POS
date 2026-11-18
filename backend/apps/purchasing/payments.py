"""Supplier payments (Sprint 5 P4, owner 2026-11-17: "sometimes on credit, with partial payments").
A credit purchase adds its stock and cost when posted; the money goes out only here, as one
expense on the day it is paid. Lock order, as everywhere: the payer's shift (drawer payments) ->
purchase rows (by id) -> the payment row."""

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_money
from apps.expenses.models import Expense
from apps.expenses.services import void_purchase_expense
from apps.shifts import services as shift_services

from .models import Purchase, Supplier, SupplierPayment, SupplierPaymentLine
from .services import _ts, _user


def payment_dict(p) -> dict:
    return {
        "id": str(p.pk),
        "supplier": {"id": str(p.supplier_id), "name": p.supplier.name},
        "amount": str(p.amount),
        "source": p.source,
        "payment_method": p.payment_method,
        "shift_id": str(p.shift_id) if p.shift_id else None,
        "note": p.note,
        "status": p.status,
        "paid_at": _ts(p.created_at),
        "created_by": _user(p.created_by),
        "void_reason": p.void_reason,
        "voided_at": _ts(p.voided_at),
        "voided_by": _user(p.voided_by),
        "lines": [
            {
                "purchase_id": str(line.purchase_id),
                "supplier_invoice_no": line.purchase.supplier_invoice_no,
                "purchased_on": line.purchase.purchased_on.isoformat(),
                "amount": str(line.amount),
            }
            for line in p.lines.all()
        ],
    }


def payments_queryset(org):
    return (
        SupplierPayment.objects.filter(organization=org)
        .select_related("supplier", "created_by", "voided_by")
        .prefetch_related("lines__purchase")
    )


def _refuse(message, why, status=422):
    return ApiError("PAYMENT_NOT_ALLOWED", message, status, {"why": why})


def _lock_purchases(org, ids):
    rows = Purchase.objects.select_for_update().filter(organization=org, pk__in=ids).order_by("pk")
    return {p.pk: p for p in rows}


def pay_supplier(actor, data) -> tuple[int, dict]:
    """Runs inside the idempotency wrapper's transaction."""
    org = actor.organization
    supplier = Supplier.objects.filter(organization=org, pk=data["supplier_id"]).first()
    if supplier is None:
        raise ApiError(
            "VALIDATION_ERROR",
            "Validation failed.",
            400,
            {"fields": {"supplier_id": "Unknown supplier."}},
        )
    shift = None
    if data["source"] == Purchase.Source.CASH_DRAWER:  # the payer's own open shift
        shift = shift_services.lock_open_shift(actor)
        if shift is None:
            raise ApiError("SHIFT_NOT_OPEN", "Open your shift to pay from the drawer.", 409)
    lines = data["lines"]
    purchases = _lock_purchases(org, sorted(line["purchase_id"] for line in lines))
    for line in lines:
        p = purchases.get(line["purchase_id"])
        if p is None or p.supplier_id != supplier.pk:
            raise _refuse("A purchase is not from this supplier.", "other_supplier", 400)
        if not p.on_credit or p.status != Purchase.Status.POSTED:
            raise _refuse("Only posted purchases on credit can be paid.", "not_on_credit")
        left = p.total - p.amount_paid
        if q_money(line["amount"]) > left:
            raise ApiError(
                "PAYMENT_EXCEEDS_OWED",
                "The payment is more than what is owed for this purchase.",
                422,
                {"purchase_id": str(p.pk), "owed": str(left)},
            )
    total = q_money(sum(q_money(line["amount"]) for line in lines))
    pay = SupplierPayment.objects.create(
        organization=org,
        supplier=supplier,
        amount=total,
        source=data["source"],
        payment_method=data["payment_method"],
        shift=shift,
        note=data.get("note", "").strip(),
        created_by=actor,
    )
    for line in lines:
        p = purchases[line["purchase_id"]]
        amount = q_money(line["amount"])
        SupplierPaymentLine.objects.create(organization=org, payment=pay, purchase=p, amount=amount)
        p.amount_paid = q_money(p.amount_paid + amount)
        p.save(update_fields=["amount_paid", "updated_at"])
    exp = Expense.objects.create(
        organization=org,
        type=Expense.Type.SUPPLIER_PAYMENT,
        category=Expense.Category.PURCHASE,
        description=f"Supplier payment: {supplier.name}",
        amount=total,
        payment_method=pay.payment_method,
        source=pay.source,
        shift=shift,
        supplier_payment=pay,
        created_by=actor,
    )
    record(
        actor,
        "supplier_payment.created",
        pay,
        {
            "supplier": supplier.name,
            "amount": str(total),
            "source": pay.source,
            "payment_method": pay.payment_method,
            "expense_id": str(exp.pk),
            "lines": [
                {"purchase_id": str(line["purchase_id"]), "amount": str(q_money(line["amount"]))}
                for line in lines
            ],
        },
    )
    return 201, payment_dict(payments_queryset(org).get(pk=pay.pk))


@transaction.atomic
def void_payment(actor, pk, reason) -> SupplierPayment:
    """Admin, reason required. The purchases are owed again and the expense is voided. A drawer
    payment of a closed shift is refused: that shift's numbers are frozen."""
    org = actor.organization
    seen = SupplierPayment.objects.filter(organization=org, pk=pk).first()
    if seen is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if seen.shift_id:
        from apps.shifts.models import CashierShift

        shift = CashierShift.objects.select_for_update().get(pk=seen.shift_id)
        if shift.status == CashierShift.Status.CLOSED:
            raise _refuse(
                "This payment was made from a shift that is already closed.", "shift_closed"
            )
    lines = list(seen.lines.all())
    purchases = _lock_purchases(org, sorted(line.purchase_id for line in lines))
    pay = SupplierPayment.objects.select_for_update().get(pk=pk)
    if pay.status == SupplierPayment.Status.VOIDED:
        raise _refuse("This payment is already voided.", "voided", 409)
    for line in lines:
        p = purchases[line.purchase_id]
        p.amount_paid = q_money(p.amount_paid - line.amount)
        p.save(update_fields=["amount_paid", "updated_at"])
    void_purchase_expense(actor, Expense.objects.get(supplier_payment=pay), reason)
    pay.status, pay.void_reason = SupplierPayment.Status.VOIDED, reason
    pay.voided_at, pay.voided_by = timezone.now(), actor
    pay.save()
    record(
        actor,
        "supplier_payment.voided",
        pay,
        {"supplier": seen.supplier.name, "amount": str(pay.amount), "reason": reason},
    )
    return payments_queryset(org).get(pk=pay.pk)
