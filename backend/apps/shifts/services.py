from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.policy import has_perm
from apps.tenancy.models import Register

from .models import CashierShift, CashMovement
from .selectors import cash_movement_dict, live_totals


@transaction.atomic
def open_shift(actor, opening_cash):
    """D7: one open shift per user. The partial unique index also settles two racing opens."""
    already = ApiError("SHIFT_ALREADY_OPEN", "You already have an open shift.", 409)
    if CashierShift.objects.filter(user=actor, status=CashierShift.Status.OPEN).exists():
        raise already
    # Users carry no branch yet (v1 is single-branch), so exactly one default register must exist;
    # zero or several (a second branch) is a setup problem, never a 500 or a guessed branch.
    registers = list(
        Register.objects.select_related("branch").filter(
            organization=actor.organization, is_default=True
        )[:2]
    )
    if len(registers) != 1:
        raise ApiError(
            "REGISTER_NOT_CONFIGURED",
            "No single default register is set up for this café. Ask an Admin.",
            422,
            {"default_registers": len(registers)},
        )
    register = registers[0]
    try:
        with transaction.atomic():
            shift = CashierShift.objects.create(
                organization=actor.organization,
                branch=register.branch,
                register=register,
                user=actor,
                opening_cash=opening_cash,
            )
    except IntegrityError:
        raise already from None
    record(actor, "shift.opened", shift, {"opening_cash": str(shift.opening_cash)})
    return shift


def current_shift(user):
    return (
        CashierShift.objects.select_related("user", "register")
        .filter(user=user, status=CashierShift.Status.OPEN)
        .first()
    )


def last_closed(user):
    """The user's own most recent closed shift as {id, closed_at, actual_cash}, or None (C2)."""
    s = (
        CashierShift.objects.filter(user=user, status=CashierShift.Status.CLOSED)
        .order_by("-closed_at")
        .only("pk", "closed_at", "actual_cash")
        .first()
    )
    if s is None:
        return None
    return {
        "id": str(s.pk),
        "closed_at": s.closed_at.isoformat().replace("+00:00", "Z"),
        "actual_cash": str(s.actual_cash),
    }


def lock_open_shift(user):
    """The user's open shift with its row locked until commit, or None. Every writer that must not
    interleave with a close (checkout, refund, drawer expense, drawer purchase) takes this first."""
    return (
        CashierShift.objects.select_for_update()
        .filter(user=user, status=CashierShift.Status.OPEN)
        .first()
    )


def get_visible(actor, pk):
    """A shift of the actor's organization: the owner's own, or any for an Admin; else None."""
    shift = (
        CashierShift.objects.select_related("user", "register", "closed_by")
        .filter(organization=actor.organization, pk=pk)
        .first()
    )
    if shift and shift.user_id != actor.pk and not has_perm(actor, "shifts.manage"):
        return None
    return shift


@transaction.atomic
def close_shift(actor, pk, actual_cash, note):
    """Spec 8.5. The shift row is locked before any total is read, so no sale, refund or drawer
    expense can commit between the read and the close."""
    visible = get_visible(actor, pk)
    if visible is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    shift = CashierShift.objects.select_for_update().get(pk=visible.pk)
    if shift.status == CashierShift.Status.CLOSED:
        raise ApiError("SHIFT_ALREADY_CLOSED", "This shift is already closed.", 409)
    totals = live_totals(shift)
    expected = Decimal(totals["expected_cash"])
    shift.expected_cash, shift.actual_cash = expected, actual_cash
    shift.difference = actual_cash - expected  # negative = shortage
    shift.close_note = note
    shift.totals_snapshot = totals
    shift.status = CashierShift.Status.CLOSED
    shift.closed_at, shift.closed_by = timezone.now(), actor
    shift.save()
    record(
        actor,
        "shift.closed",
        shift,
        {
            "owner_id": str(shift.user_id),
            "expected_cash": str(expected),
            "actual_cash": str(actual_cash),
            "difference": str(shift.difference),
            "note": note,
            "totals": totals,
        },
    )
    return get_visible(actor, shift.pk)


def move_cash(actor, data, key) -> tuple[int, dict]:
    """Cash put into / taken out of the actor's own open drawer (owner, 2026-11-16: Barista and
    Admin, own shift). Runs inside the idempotency wrapper's transaction; the shift row lock keeps
    a concurrent close from missing it."""
    shift = lock_open_shift(actor)
    if shift is None:
        raise ApiError("SHIFT_NOT_OPEN", "Open your shift before moving cash.", 409)
    m = CashMovement.objects.create(
        organization=actor.organization,
        shift=shift,
        kind=data["kind"],
        amount=data["amount"],
        reason=data["reason"],
        created_by=actor,
        idempotency_key=key,
    )
    record(
        actor,
        "cash.added" if data["kind"] == CashMovement.Kind.IN else "cash.removed",
        m,
        {"amount": str(m.amount), "reason": m.reason, "shift_id": str(shift.pk)},
    )
    m = CashMovement.objects.select_related("created_by", "voided_by").get(pk=m.pk)
    return 201, cash_movement_dict(m)


@transaction.atomic
def void_cash_movement(actor, pk, reason):
    """Admin. Lock order as a close: shift -> movement. Only while the shift is still open (a
    closed shift's numbers are frozen), same rule as drawer expenses."""
    seen = CashMovement.objects.filter(organization=actor.organization, pk=pk).first()
    if seen is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    shift = CashierShift.objects.select_for_update().get(pk=seen.shift_id)
    m = CashMovement.objects.select_for_update().get(pk=pk)

    def refuse(why):
        raise ApiError("CASH_MOVEMENT_NOT_VOIDABLE", "This cannot be cancelled.", 422, {"why": why})

    if m.status == CashMovement.Status.VOIDED:
        refuse("already_voided")
    if shift.status == CashierShift.Status.CLOSED:
        refuse("shift_closed")
    m.status, m.void_reason, m.voided_by, m.voided_at = (
        CashMovement.Status.VOIDED,
        reason,
        actor,
        timezone.now(),
    )
    m.save()
    record(
        actor,
        "cash.voided",
        m,
        {
            "kind": m.kind,
            "amount": str(m.amount),
            "reason": reason,
            "original_reason": m.reason,
            "shift_id": str(shift.pk),
        },
    )
    return CashMovement.objects.select_related("created_by", "voided_by").get(pk=pk)
