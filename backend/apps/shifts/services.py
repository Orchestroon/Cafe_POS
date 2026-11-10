from django.db import IntegrityError, transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.tenancy.models import Register

from .models import CashierShift


@transaction.atomic
def open_shift(actor, opening_cash):
    """D7: one open shift per user. The partial unique index also settles two racing opens."""
    already = ApiError("SHIFT_ALREADY_OPEN", "You already have an open shift.", 409)
    if CashierShift.objects.filter(user=actor, status=CashierShift.Status.OPEN).exists():
        raise already
    register = Register.objects.select_related("branch").get(
        organization=actor.organization, is_default=True
    )
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
