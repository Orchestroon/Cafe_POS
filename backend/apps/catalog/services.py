from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.modifiers.models import ModifierGroup, ProductModifierGroup


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


@transaction.atomic
def replace_modifier_groups(actor, product, links):
    product = type(product).objects.select_for_update().get(pk=product.pk)  # serialize replaces
    ids = [str(link["group_id"]) for link in links]
    if len(set(ids)) != len(ids):
        raise ApiError("VALIDATION_ERROR", "Duplicate groups.", 400)
    groups = {
        str(g.pk): g
        for g in ModifierGroup.objects.filter(organization=actor.organization, pk__in=ids)
    }
    missing = [i for i in ids if i not in groups]
    if missing:
        raise ApiError(
            "VALIDATION_ERROR", "Unknown modifier group.", 400, {"fields": {"group_id": missing}}
        )
    before = [
        {"group_id": str(link.group_id), "sort_order": link.sort_order}
        for link in product.modifier_links.all()
    ]
    product.modifier_links.all().delete()
    ProductModifierGroup.objects.bulk_create(
        [
            ProductModifierGroup(
                organization=actor.organization,
                product=product,
                group=groups[str(link["group_id"])],
                sort_order=link["sort_order"],
            )
            for link in links
        ]
    )
    after = [
        {"group_id": str(link["group_id"]), "sort_order": link["sort_order"]} for link in links
    ]
    if before != after:
        record(
            actor, "product.modifier_groups_replaced", product, {"before": before, "after": after}
        )
