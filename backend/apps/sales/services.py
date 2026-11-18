from django.utils import timezone

from apps.core.exceptions import ApiError
from apps.inventory.models import StockBalance
from apps.inventory.services import cost_missing

from . import consumption, loader, pricing
from .domain import ItemRequest


def to_requests(items) -> list[ItemRequest]:
    if not items:
        raise ApiError("EMPTY_CART", "The cart is empty.", 422)
    return [
        ItemRequest(i["variant_id"], i["quantity"], tuple(i.get("modifier_option_ids", ())))
        for i in items
    ]


def price_and_consume(org, requests, promotion_ids=()):
    """The calculation quote and checkout share: (priced order, consumption per item, required).
    `promotion_ids` are the manual promotions tapped; the server decides what applies."""
    variants, options = loader.load(org, requests)
    settings = loader.load_settings(org)
    priced = pricing.price_order(
        requests,
        variants,
        options,
        loader.load_tax(org, settings),
        loader.load_promotions(org, timezone.now(), settings),
        frozenset(promotion_ids),
    )
    consumptions = [consumption.consume_item(p) for p in priced.items]
    required = consumption.aggregate(consumptions)
    _require_costs(org, required)
    return priced, consumptions, required


def _require_costs(org, required):
    """Sprint 5 L3 (owner, 2026-11-17): nothing is sold without a known cost. An ingredient
    with no average cost was never stocked with a value, so the whole cart is refused (quote and
    checkout alike), like RECIPE_MISSING. A set average never goes back to None, so this
    unlocked read cannot let a costless sale through."""
    priced = {
        str(i)
        for i in StockBalance.objects.filter(
            organization=org, ingredient_id__in=list(required), avg_cost__isnull=False
        ).values_list("ingredient_id", flat=True)
    }
    names = [r["name"] for k, r in required.items() if k not in priced]
    if names:
        raise cost_missing(names)


def quote_payload(priced, required, warnings) -> dict:
    return {
        "subtotal": str(priced.subtotal),
        "discount_total": str(priced.discount_total),
        "tax_total": str(priced.tax_total),
        "total": str(priced.total),
        "tax": priced.tax.snapshot(),
        "promotions": [{**a, "amount": str(a["amount"])} for a in priced.applied],
        "selectable": [{**s, "gain": str(s["gain"])} for s in priced.selectable],
        "items": [
            {
                "variant_id": str(p.variant.id),
                "product_name": p.variant.product_name,
                "variant_label": p.variant.label,
                "quantity": p.request.quantity,
                "unit_price": str(p.unit_price),
                "unit_discount": str(p.unit_discount),
                "line_subtotal": str(p.line_subtotal),
                "line_discount": str(p.line_discount),
                "line_total": str(p.line_total),
                "promotions": [
                    {"id": r["promotion_id"], "name": r["name"], "amount": r["amount"]}
                    for r in p.promotions
                ],
                "modifiers": [
                    {
                        "option_id": m["option_id"],
                        "label": m["option_label"],
                        "price_delta": m["price_delta"],
                    }
                    for m in p.modifiers
                ],
            }
            for p in priced.items
        ],
        "consumption": [
            {
                "ingredient_id": r["ingredient_id"],
                "name": r["name"],
                "unit": r["unit"],
                "required": str(r["required"]),
            }
            for r in required.values()
        ],
        "stock_warnings": warnings,
    }


def quote(org, items, promotion_ids=()) -> dict:
    """Read-only: no locks, no writes, no shift needed (spec 8.3)."""
    priced, _, required = price_and_consume(org, to_requests(items), promotion_ids)
    available = loader.read_balances(org, list(required))
    return quote_payload(priced, required, consumption.stock_warnings(required, available))
