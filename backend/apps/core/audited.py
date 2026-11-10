"""Generic audited create/update for simple admin models (category, product, variant, modifier
group). The row is locked and re-read before an update so the audited "before" is the committed
value (concurrent price edits record a consistent chain)."""

from django.db import transaction

from apps.audit.services import record


def _norm(x):
    return str(x.pk) if hasattr(x, "pk") else str(x)


def _diff(instance, changes):
    out = {}
    for k, v in changes.items():
        before, after = _norm(getattr(instance, k)), _norm(v)
        if before != after:
            out[f"{k}_id" if hasattr(v, "pk") else k] = {"before": before, "after": after}
    return out


def _snap(obj, fields):
    return {f: str(getattr(obj, f)) for f in fields}


@transaction.atomic
def create_obj(actor, serializer, action, fields, **extra):
    obj = serializer.save(organization=actor.organization, **extra)
    record(actor, action, obj, {"after": _snap(obj, fields)})
    return obj


@transaction.atomic
def update_obj(actor, serializer, action):
    # Lock and re-read so the audited "before" is the committed value (concurrent price edits).
    instance = type(serializer.instance).objects.select_for_update().get(pk=serializer.instance.pk)
    serializer.instance = instance
    changes = _diff(instance, serializer.validated_data)
    obj = serializer.save()
    if changes:
        record(actor, action, obj, {"changes": changes})
    return obj
