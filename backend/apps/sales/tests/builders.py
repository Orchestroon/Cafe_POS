"""Tiny builders for the pure engine tests (no database)."""

from decimal import Decimal
from uuid import uuid4

from apps.sales.domain import (
    EffectData,
    GroupData,
    OptionData,
    RecipeLineData,
    VariantData,
)

D = Decimal


def group(name="Milk Type", mode="replace", slot="milk", lo=0, hi=1, active=True):
    return GroupData(uuid4(), name, mode, slot if mode == "replace" else None, lo, hi, active)


def effect(ing, qty, waste="0", variant_id=None):
    return EffectData(variant_id, ing["id"], ing["name"], ing["unit"], D(qty), D(waste))


def option(grp, label="Opt", price="0", effects=(), prices=None, active=True, track=None):
    """`track` defaults to "has effects": an option built without effects is a "No stock effect"
    option unless the test says otherwise (R2)."""
    track = bool(effects) if track is None else track
    return OptionData(uuid4(), label, grp.id, active, D(price), prices or {}, tuple(effects), track)


def ingredient(name, unit="g"):
    return {"id": uuid4(), "name": name, "unit": unit}


def line(ing, qty, waste="0", slot=None):
    return RecipeLineData(ing["id"], ing["name"], ing["unit"], D(qty), D(waste), slot)


def variant(
    price="65.00",
    label="Small",
    groups=(),
    recipe=(),
    active=True,
    product_active=True,
    category_active=True,
    track=None,
):
    """`track` defaults to "has a recipe" (B3), so engine tests that only price need no recipe."""
    track = bool(recipe) if track is None else track
    return VariantData(
        uuid4(),
        label,
        D(price),
        active,
        uuid4(),
        "Iced Latte",
        product_active,
        category_active,
        tuple(groups),
        tuple(recipe),
        track,
    )
