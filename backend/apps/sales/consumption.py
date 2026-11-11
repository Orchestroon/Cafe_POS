"""Consumption engine (spec 8.2). Pure: no database access.

Recipe lines (keyed by slot) are changed by the selected options, waste is applied exactly once per
line, then everything is multiplied by the quantity and aggregated per ingredient."""

from dataclasses import dataclass
from decimal import Decimal

from apps.core.exceptions import ApiError
from apps.core.money import q_qty

from .domain import EffectData, OptionData, PricedItem, RecipeLineData

ZERO = Decimal("0.000")


@dataclass(frozen=True)
class WorkingLine:
    ingredient_id: object
    ingredient_name: str
    unit: str
    base_qty: Decimal
    waste_pct: Decimal
    slot_key: str | None
    source: str  # "recipe" | "modifier"
    option_id: object = None


@dataclass(frozen=True)
class ItemConsumption:
    lines: tuple[WorkingLine, ...]  # final working lines (recipe_snapshot)
    per_ingredient: tuple[dict, ...]  # consumption_snapshot rows


def _invalid(message, **details):
    return ApiError("INVALID_MODIFIER", message, 422, details)


def resolve_effects(option: OptionData, variant_id) -> list[EffectData]:
    """Spec 7.4: size-specific effects win; else "all sizes". An option marked "No stock effect"
    (track_stock False) has no inventory impact; any other option with no effect for this size is
    invalid (R2, owner 2026-11-11: never deduct nothing silently)."""
    if not option.track_stock:
        return []
    if not option.effects:
        raise _invalid(
            "This option has no ingredient set up. Ask an Admin.",
            option_id=str(option.id),
            reason="no_effect",
        )
    specific = [e for e in option.effects if e.variant_id == variant_id]
    if specific:
        return specific
    general = [e for e in option.effects if e.variant_id is None]
    if general:
        return general
    raise _invalid(
        "This option has no ingredient effect for this size.",
        option_id=str(option.id),
        reason="no_effect_for_variant",
    )


def _from_recipe(line: RecipeLineData) -> WorkingLine:
    return WorkingLine(
        line.ingredient_id,
        line.ingredient_name,
        line.unit,
        line.base_qty,
        line.waste_pct,
        line.slot_key,
        "recipe",
    )


def _from_effect(effect: EffectData, option: OptionData) -> WorkingLine:
    return WorkingLine(
        effect.ingredient_id,
        effect.ingredient_name,
        effect.unit,
        effect.base_qty,
        effect.waste_pct,
        None,
        "modifier",
        option.id,
    )


def per_unit_qty(line: WorkingLine) -> Decimal:
    """Waste is applied exactly once, here (AT-03: 12 g + 5% = 12.600)."""
    return q_qty(line.base_qty * (1 + line.waste_pct / 100))


def consume_item(priced: PricedItem) -> ItemConsumption:
    variant = priced.variant
    if variant.track_stock and not variant.recipe:  # B3: never sell a tracked size silently
        raise ApiError(
            "RECIPE_MISSING",
            f"{variant.product_name} ({variant.label}) has no recipe. Ask an Admin.",
            422,
            {
                "variant_id": str(variant.id),
                "product_name": variant.product_name,
                "variant_label": variant.label,
            },
        )
    working = [_from_recipe(r) for r in variant.recipe]
    groups = {g.id: g for g in variant.linked_groups}
    by_group: dict = {}
    for opt in priced.options:  # grouped, keeping the order groups first appear
        by_group.setdefault(opt.group_id, []).append(opt)
    for group_id, opts in by_group.items():
        group = groups[group_id]
        if group.mode == "replace":
            if not any(w.slot_key == group.replacement_slot for w in working):
                raise _invalid(
                    f"The recipe has no '{group.replacement_slot}' to replace.",
                    group_id=str(group.id),
                    reason="slot_missing",
                    slot=group.replacement_slot,
                )
            working = [w for w in working if w.slot_key != group.replacement_slot]  # once
        for opt in opts:
            working.extend(_from_effect(e, opt) for e in resolve_effects(opt, variant.id))

    totals: dict = {}
    for w in working:
        row = totals.setdefault(
            w.ingredient_id,
            {
                "ingredient_id": str(w.ingredient_id),
                "ingredient_name": w.ingredient_name,
                "unit": w.unit,
                "qty_per_unit": ZERO,
            },
        )
        row["qty_per_unit"] += per_unit_qty(w)
    qty = priced.request.quantity
    rows = tuple(
        {
            "ingredient_id": r["ingredient_id"],
            "ingredient_name": r["ingredient_name"],
            "unit": r["unit"],
            "qty_per_unit": str(r["qty_per_unit"]),
            "total_qty": str(q_qty(r["qty_per_unit"] * qty)),
        }
        for r in totals.values()
        if r["qty_per_unit"] > 0
    )
    return ItemConsumption(tuple(working), rows)


def aggregate(consumptions: list[ItemConsumption]) -> dict:
    """Order-wide required quantity per ingredient: {ingredient_id(str): row}."""
    out: dict = {}
    for c in consumptions:
        for r in c.per_ingredient:
            row = out.setdefault(
                r["ingredient_id"],
                {
                    "ingredient_id": r["ingredient_id"],
                    "name": r["ingredient_name"],
                    "unit": r["unit"],
                    "required": ZERO,
                },
            )
            row["required"] += Decimal(r["total_qty"])
    return out


def stock_warnings(required: dict, available: dict) -> list[dict]:
    """Never blocks a sale (spec 8.2). `available` maps ingredient_id(str) -> current balance."""
    warnings = []
    for ing_id, row in required.items():
        have = available.get(ing_id, ZERO)
        projected = q_qty(have - row["required"])
        if projected < 0:
            warnings.append(
                {
                    "ingredient_id": ing_id,
                    "ingredient_name": row["name"],
                    "unit": row["unit"],
                    "available": str(q_qty(have)),
                    "required": str(q_qty(row["required"])),
                    "projected_balance": str(projected),
                }
            )
    return sorted(warnings, key=lambda w: w["ingredient_name"])
