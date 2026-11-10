from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_qty
from apps.inventory.models import Ingredient
from apps.modifiers.models import ModifierGroup, ProductModifierGroup

from .models import ProductVariant, RecipeLine


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


def _line_dict(line):
    return {
        "ingredient_id": str(line.ingredient_id),
        "ingredient_name": line.ingredient.name,
        "unit": line.ingredient.base_unit,
        "base_qty": str(line.base_qty),
        "waste_pct": str(line.waste_pct),
        "slot_key": line.slot_key,
    }


def recipe_warnings(variant, slots=None):
    """Replace groups linked to the product whose slot is missing from this recipe (spec 8.10)."""
    if slots is None:
        slots = set(
            RecipeLine.objects.filter(variant=variant, slot_key__isnull=False).values_list(
                "slot_key", flat=True
            )
        )
    links = (
        ProductModifierGroup.objects.filter(product_id=variant.product_id, group__mode="replace")
        .select_related("group")
        .order_by("sort_order")
    )
    return [
        {
            "code": "SLOT_MISSING",
            "group_id": str(link.group_id),
            "group_name": link.group.name,
            "replacement_slot": link.group.replacement_slot,
        }
        for link in links
        if link.group.replacement_slot not in slots
    ]


def recipe_payload(variant):
    lines = list(variant.recipe_lines.select_related("ingredient"))
    return {
        "variant_id": str(variant.pk),
        "lines": [_line_dict(line) for line in lines],
        "warnings": recipe_warnings(variant),
        "updated_at": variant.updated_at.isoformat().replace("+00:00", "Z"),
    }


def _invalid_recipe(errors):
    raise ApiError("INVALID_RECIPE", "Recipe validation failed.", 422, {"lines": errors})


@transaction.atomic
def replace_recipe(actor, variant, lines):
    variant = ProductVariant.objects.select_for_update().get(pk=variant.pk)  # serialize replaces
    org = actor.organization
    errors, seen_ing, seen_slot = [], set(), set()
    ings = {
        i.pk: i
        for i in Ingredient.objects.filter(
            organization=org, pk__in=[line["ingredient_id"] for line in lines]
        )
    }
    clean = []
    for idx, line in enumerate(lines):
        problems = []
        ing = ings.get(line["ingredient_id"])
        if ing is None:
            problems.append("ingredient_not_found")
        elif not ing.is_active:
            problems.append("ingredient_inactive")
        if line["ingredient_id"] in seen_ing:
            problems.append("duplicate_ingredient")
        seen_ing.add(line["ingredient_id"])
        qty, waste = line["base_qty"], line["waste_pct"]
        if qty < 0:
            problems.append("base_qty_negative")
        if not (0 <= waste <= 100):
            problems.append("waste_pct_out_of_range")
        slot = line.get("slot_key") or None
        if slot is not None:
            if slot in seen_slot:
                problems.append("duplicate_slot")
            seen_slot.add(slot)
        if problems:
            errors.append({"index": idx, "problems": problems})
        else:
            clean.append((ing, q_qty(qty), waste, slot))
    if errors:
        _invalid_recipe(errors)

    before = [_line_dict(line) for line in variant.recipe_lines.select_related("ingredient")]
    variant.recipe_lines.all().delete()
    RecipeLine.objects.bulk_create(
        [
            RecipeLine(
                organization=org,
                variant=variant,
                ingredient=ing,
                base_qty=qty,
                waste_pct=waste,
                slot_key=slot,
            )
            for ing, qty, waste, slot in clean
        ]
    )
    variant.save(update_fields=["updated_at"])  # concurrency token for the editor
    after = [_line_dict(line) for line in variant.recipe_lines.select_related("ingredient")]
    if before != after:
        record(
            actor,
            "recipe.replaced",
            variant,
            {
                "product": variant.product.name,
                "variant": variant.label,
                "before": before,
                "after": after,
            },
        )
    return variant
