from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError

from .models import User


def _other_active_admins(org, exclude_id):
    # Lock all active admins of the org so two concurrent demotions cannot both pass the check.
    admins = list(
        User.objects.select_for_update()
        .filter(organization=org, role=User.Role.ADMIN, is_active=True)
        .order_by("id")
    )
    return [a for a in admins if a.id != exclude_id]


@transaction.atomic
def create_user(actor, *, username, password, role, display_name=""):
    user = User.objects.create_user(
        username=username,
        password=password,
        role=role,
        display_name=display_name,
        organization=actor.organization,
    )
    record(actor, "user.created", user, {"username": username, "role": role})
    return user


@transaction.atomic
def update_user(actor, user, changes):
    user = User.objects.select_for_update().get(pk=user.pk)
    deactivating = user.is_active and changes.get("is_active") is False
    demoting = user.role == User.Role.ADMIN and changes.get("role") == User.Role.BARISTA
    if deactivating and user.pk == actor.pk:
        raise ApiError("CANNOT_DEACTIVATE_SELF", "You cannot deactivate yourself.", 422)
    if (deactivating or demoting) and user.role == User.Role.ADMIN and user.is_active:
        if not _other_active_admins(user.organization, user.pk):
            raise ApiError(
                "LAST_ADMIN", "The last active admin cannot be deactivated or demoted.", 422
            )

    before = {k: getattr(user, k) for k in changes}
    for k, v in changes.items():
        setattr(user, k, v)
    user.save()
    diff = {
        k: {"before": before[k], "after": changes[k]} for k in changes if before[k] != changes[k]
    }
    if diff:
        if deactivating:
            action = "user.deactivated"
        elif changes.get("is_active") is True and before["is_active"] is False:
            action = "user.reactivated"
        else:
            action = "user.updated"
        record(actor, action, user, {"changes": diff})
    return user


@transaction.atomic
def reset_password(actor, user, password):
    user.set_password(password)  # changes the session auth hash: existing sessions stop working
    user.save(update_fields=["password"])
    record(actor, "user.password_reset", user, {"username": user.username})
