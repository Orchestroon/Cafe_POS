"""Full refund of a paid order (spec 8.6, owner decisions D8/D9, 2026-11-10).

Lock order: the refunding user's open shift -> the order row. A shift close takes the same shift
lock first, so a refund can never slip into a shift that is being closed."""

from django.db import IntegrityError, transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_money
from apps.shifts import services as shift_services

from . import selectors
from .models import Order, Payment, Refund, RefundLine


def refund_order(user, order_id, data, key) -> tuple[int, dict]:
    """Runs inside the idempotency wrapper's transaction. Returns (201, body)."""
    org = user.organization
    seen = selectors.get_order(user, order_id)
    if seen is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    needs_cash = any(p.method == Payment.Method.CASH for p in seen.payments.all())
    shift = shift_services.lock_open_shift(user)  # 1. may be None
    if needs_cash and shift is None:
        raise ApiError("SHIFT_NOT_OPEN", "Open your shift before refunding cash.", 409)
    order = Order.objects.select_for_update().get(pk=seen.pk, organization=org)  # 2.
    if order.status != Order.Status.PAID:
        raise ApiError("REFUND_ALREADY_APPLIED", "This order is already refunded.", 409)
    if q_money(data["confirm_amount"]) != order.total:
        raise ApiError(
            "PARTIAL_REFUND_NOT_SUPPORTED",
            "Only a full refund is supported; confirm_amount must equal the order total.",
            422,
            {"order_total": str(order.total)},
        )
    payments = list(order.payments.all())
    ref = (data.get("card_external_reference") or "").strip()
    if ref and not any(p.method == Payment.Method.CARD for p in payments):
        raise ApiError(
            "VALIDATION_ERROR",
            "Validation failed.",
            400,
            {"fields": {"card_external_reference": "The order has no card payment."}},
        )
    try:
        with transaction.atomic():  # savepoint: a clash must not poison the outer transaction
            refund = Refund.objects.create(
                organization=org,
                order=order,
                actor=user,
                shift=shift,
                reason=data["reason"],
                total_amount=order.total,
                idempotency_key=key,
            )
    except IntegrityError:
        # The idempotency scope is per order, so the same key sent for another order collides here
        # (order is already locked and unrefunded, so this can only be the key).
        raise ApiError(
            "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was used with a different request.", 409
        ) from None
    lines = [  # D9: one line per original payment, same method and amount
        RefundLine.objects.create(
            organization=org,
            refund=refund,
            original_payment=p,
            method=p.method,
            amount=p.amount,
            external_reference=ref if p.method == Payment.Method.CARD else "",
        )
        for p in payments
    ]
    order.status = Order.Status.REFUNDED
    order.save(update_fields=["status", "updated_at"])
    line_summary = [{"method": ln.method, "amount": str(ln.amount)} for ln in lines]
    record(
        user,
        "refund.created",
        refund,
        {
            "order_id": str(order.pk),
            "invoice_no": order.invoice_no,
            "reason": refund.reason,
            "total_amount": str(refund.total_amount),
            "lines": line_summary,
            "original_cashier_id": str(order.cashier_id),
            "shift_id": str(shift.pk) if shift else None,
        },
    )
    return 201, {
        "refund_id": str(refund.pk),
        "order_id": str(order.pk),
        "invoice_no": order.invoice_no,
        "status": order.status,
        "total_amount": str(refund.total_amount),
        "lines": [
            {**ln, "external_reference": ref if ln["method"] == "card" else ""}
            for ln in line_summary
        ],
        "shift_id": str(shift.pk) if shift else None,
        "inventory_restored": False,
    }
