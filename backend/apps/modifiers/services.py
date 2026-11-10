from django.db import transaction

from apps.audit.services import record
from apps.catalog.models import ProductVariant
from apps.core.exceptions import ApiError
from apps.core.money import q_qty
from apps.inventory.models import Ingredient

from .models import ModifierEffect, ModifierGroup, ModifierOption, ModifierOptionPrice


def _bad(field, message, ids=None):
    raise ApiError(
        "VALIDATION_ERROR", message, 400, {"fields": {field: ids if ids is not None else message}}
    )


def snapshot(option):
    return {
        "label": option.label,
        "price_delta": str(option.price_delta),
        "sort_order": option.sort_order,
        "is_active": option.is_active,
        "variant_prices": sorted(
            ({"variant_id": str(p.variant_id), "price_delta": str(p.price_delta)})
            for p in option.prices.all()
        ),
        "effects": sorted(
            (
                {
                    "variant_id": str(e.variant_id) if e.variant_id else None,
                    "ingredient_id": str(e.ingredient_id),
                    "base_qty": str(e.base_qty),
                    "waste_pct": str(e.waste_pct),
                }
                for e in option.effects.all()
            ),
            key=lambda e: (e["variant_id"] or "", e["ingredient_id"]),
        ),
    }


def _set_prices(org, option, rows):
    ids = [r["variant_id"] for r in rows]
    if len(set(ids)) != len(ids):
        _bad("variant_prices", "Duplicate size.")
    found = set(
        ProductVariant.objects.filter(organization=org, pk__in=ids).values_list("pk", flat=True)
    )
    if missing := [str(i) for i in ids if i not in found]:
        _bad("variant_prices", "Unknown size.", missing)
    option.prices.all().delete()
    ModifierOptionPrice.objects.bulk_create(
        [
            ModifierOptionPrice(
                organization=org,
                option=option,
                variant_id=r["variant_id"],
                price_delta=r["price_delta"],
            )
            for r in rows
        ]
    )


def _set_effects(org, option, rows):
    keys = [(r["variant_id"], r["ingredient_id"]) for r in rows]
    if len(set(keys)) != len(keys):
        _bad("effects", "Duplicate effect (same size and ingredient).")
    var_ids = {r["variant_id"] for r in rows if r["variant_id"]}
    found = set(
        ProductVariant.objects.filter(organization=org, pk__in=var_ids).values_list("pk", flat=True)
    )
    if missing := [str(i) for i in var_ids if i not in found]:
        _bad("effects", "Unknown size.", missing)
    ing_ids = {r["ingredient_id"] for r in rows}
    ok = set(
        Ingredient.objects.filter(organization=org, is_active=True, pk__in=ing_ids).values_list(
            "pk", flat=True
        )
    )
    if missing := [str(i) for i in ing_ids if i not in ok]:
        _bad("effects", "Unknown or inactive ingredient.", missing)
    option.effects.all().delete()
    ModifierEffect.objects.bulk_create(
        [
            ModifierEffect(
                organization=org,
                option=option,
                variant_id=r["variant_id"],
                ingredient_id=r["ingredient_id"],
                base_qty=q_qty(r["base_qty"]),
                waste_pct=r["waste_pct"],
            )
            for r in rows
        ]
    )


def _check_label(group, label, exclude=None):
    qs = ModifierOption.objects.filter(group=group, label__iexact=label)
    if exclude:
        qs = qs.exclude(pk=exclude.pk)
    if qs.exists():
        _bad("label", "An option with this label already exists in the group.")


@transaction.atomic
def create_option(actor, group, data):
    org = actor.organization
    group = ModifierGroup.objects.select_for_update().get(pk=group.pk)
    _check_label(group, data["label"])
    option = ModifierOption.objects.create(
        organization=org,
        group=group,
        label=data["label"],
        price_delta=data["price_delta"],
        sort_order=data["sort_order"],
        is_active=data["is_active"],
    )
    _set_prices(org, option, data.get("variant_prices", []))
    _set_effects(org, option, data.get("effects", []))
    record(
        actor,
        "modifier_option.created",
        option,
        {"group": group.name, "after": snapshot(option)},
    )
    return option


@transaction.atomic
def update_option(actor, option, data):
    org = actor.organization
    option = ModifierOption.objects.select_for_update().select_related("group").get(pk=option.pk)
    before = snapshot(option)
    if "label" in data:
        _check_label(option.group, data["label"], exclude=option)
    for field in ("label", "price_delta", "sort_order", "is_active"):
        if field in data:
            setattr(option, field, data[field])
    option.save()
    if "variant_prices" in data:
        _set_prices(org, option, data["variant_prices"])
    if "effects" in data:
        _set_effects(org, option, data["effects"])
    option = ModifierOption.objects.get(pk=option.pk)
    after = snapshot(option)
    if before != after:
        record(
            actor,
            "modifier_option.updated",
            option,
            {"group": option.group.name, "before": before, "after": after},
        )
    return option
