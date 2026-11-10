"""Turns database rows into the plain data the pure engines use (one fixed set of queries)."""

from collections import defaultdict

from django.db.models import Prefetch

from apps.catalog.models import ProductVariant, RecipeLine
from apps.inventory.models import StockBalance
from apps.inventory.services import lock_balances
from apps.modifiers.models import ModifierEffect, ModifierOption, ProductModifierGroup
from apps.tenancy.models import OrganizationSettings
from apps.tenancy.seed import default_location

from .domain import (
    EffectData,
    GroupData,
    OptionData,
    RecipeLineData,
    TaxConfig,
    VariantData,
)


def load_tax(org) -> TaxConfig:
    s = OrganizationSettings.objects.get(organization=org)
    return TaxConfig(s.tax_enabled, s.tax_rate, s.prices_include_tax, s.tax_label)


def load(org, requests):
    """Returns (variants, options) dicts keyed by id, for the variants/options the cart names."""
    variant_ids = {r.variant_id for r in requests}
    option_ids = {o for r in requests for o in r.option_ids}

    rows = ProductVariant.objects.filter(organization=org, pk__in=variant_ids).select_related(
        "product__category"
    )
    rows = list(rows)
    product_ids = {v.product_id for v in rows}

    groups = defaultdict(list)
    links = (
        ProductModifierGroup.objects.filter(organization=org, product_id__in=product_ids)
        .select_related("group")
        .order_by("sort_order", "group__name")
    )
    for link in links:
        g = link.group
        groups[link.product_id].append(
            GroupData(
                g.pk, g.name, g.mode, g.replacement_slot, g.min_select, g.max_select, g.is_active
            )
        )

    recipes = defaultdict(list)
    lines = RecipeLine.objects.filter(organization=org, variant_id__in=variant_ids).select_related(
        "ingredient"
    )
    for r in lines:
        recipes[r.variant_id].append(
            RecipeLineData(
                r.ingredient_id,
                r.ingredient.name,
                r.ingredient.base_unit,
                r.base_qty,
                r.waste_pct,
                r.slot_key,
            )
        )

    variants = {
        v.pk: VariantData(
            id=v.pk,
            label=v.label,
            price=v.price,
            is_active=v.is_active,
            product_id=v.product_id,
            product_name=v.product.name,
            product_is_active=v.product.is_active,
            category_is_active=v.product.category.is_active,
            linked_groups=tuple(groups[v.product_id]),
            recipe=tuple(recipes[v.pk]),
        )
        for v in rows
    }

    opts = ModifierOption.objects.filter(organization=org, pk__in=option_ids).prefetch_related(
        "prices", Prefetch("effects", ModifierEffect.objects.select_related("ingredient"))
    )
    options = {
        o.pk: OptionData(
            id=o.pk,
            label=o.label,
            group_id=o.group_id,
            is_active=o.is_active,
            price_delta=o.price_delta,
            variant_prices={p.variant_id: p.price_delta for p in o.prices.all()},
            effects=tuple(
                EffectData(
                    e.variant_id,
                    e.ingredient_id,
                    e.ingredient.name,
                    e.ingredient.base_unit,
                    e.base_qty,
                    e.waste_pct,
                )
                for e in o.effects.all()
            ),
        )
        for o in opts
    }
    return variants, options


def read_balances(org, ingredient_ids) -> dict:
    """Unlocked read for quotes: {ingredient_id(str): qty}."""
    rows = StockBalance.objects.filter(
        organization=org, location=default_location(org), ingredient_id__in=ingredient_ids
    )
    return {str(b.ingredient_id): b.qty for b in rows}


def locked_balances(org, ingredient_ids) -> dict:
    """Checkout: lock in ingredient_id order. Returns {ingredient_id (UUID): StockBalance}."""
    return lock_balances(org, sorted(ingredient_ids))
