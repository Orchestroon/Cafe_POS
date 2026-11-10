"""Pricing engine (spec 8.1). Pure: no database access. Quote and checkout share `price_order`."""

from decimal import Decimal

from apps.core.exceptions import ApiError
from apps.core.money import q_money

from .domain import ItemRequest, OptionData, PricedItem, PricedOrder, TaxConfig, VariantData

ZERO = Decimal("0.00")


def _422(code, message, **details):
    return ApiError(code, message, 422, details)


def option_price(option: OptionData, variant_id) -> Decimal:
    """Per-size override if one exists, else the option's own price_delta."""
    return option.variant_prices.get(variant_id, option.price_delta)


def _validate_quantity(qty):
    if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= 99:
        raise _422("INVALID_QUANTITY", "Quantity must be a whole number from 1 to 99.")


def _selected_options(item: ItemRequest, variant: VariantData, options: dict) -> list[OptionData]:
    if len(set(item.option_ids)) != len(item.option_ids):
        raise _422(
            "MODIFIER_SELECTION_INVALID", "An option was selected twice.", reason="duplicate_option"
        )
    groups = {g.id: g for g in variant.linked_groups}
    chosen, per_group = [], {}
    for oid in item.option_ids:
        opt = options.get(oid)
        grp = groups.get(opt.group_id) if opt else None
        if opt is None or grp is None or not opt.is_active or not grp.is_active:
            raise _422(
                "INVALID_MODIFIER",
                "This option is not available for this product.",
                option_id=str(oid),
                reason="unavailable",
            )
        chosen.append(opt)
        per_group[grp.id] = per_group.get(grp.id, 0) + 1
    for grp in variant.linked_groups:
        if not grp.is_active:
            continue
        n = per_group.get(grp.id, 0)
        if not grp.min_select <= n <= grp.max_select:
            raise _422(
                "MODIFIER_SELECTION_INVALID",
                f"Choose between {grp.min_select} and {grp.max_select} for {grp.name}.",
                group_id=str(grp.id),
                group_name=grp.name,
                selected=n,
                min_select=grp.min_select,
                max_select=grp.max_select,
            )
    return chosen


def price_item(item: ItemRequest, variant: VariantData | None, options: dict) -> PricedItem:
    _validate_quantity(item.quantity)
    if variant is None or not variant.sellable:
        raise _422(
            "ITEM_UNAVAILABLE", "This item is not available.", variant_id=str(item.variant_id)
        )
    chosen = _selected_options(item, variant, options)
    groups = {g.id: g for g in variant.linked_groups}
    modifiers = tuple(
        {
            "group_id": str(o.group_id),
            "group_name": groups[o.group_id].name,
            "mode": groups[o.group_id].mode,
            "option_id": str(o.id),
            "option_label": o.label,
            "price_delta": str(option_price(o, variant.id)),
        }
        for o in chosen
    )
    unit_price = q_money(variant.price + sum((option_price(o, variant.id) for o in chosen), ZERO))
    unit_discount = ZERO  # P1 promotions: the hook is here; no promotions exist yet (spec 8.12)
    line_subtotal = q_money(unit_price * item.quantity)
    line_discount = q_money(unit_discount * item.quantity)
    return PricedItem(
        request=item,
        variant=variant,
        options=tuple(chosen),
        unit_price=unit_price,
        unit_discount=unit_discount,
        line_subtotal=line_subtotal,
        line_discount=line_discount,
        line_total=q_money(line_subtotal - line_discount),
        modifiers=modifiers,
    )


def order_totals(subtotal: Decimal, discount_total: Decimal, tax: TaxConfig):
    """Returns (tax_total, total) per the spec 8.1 table."""
    net = q_money(subtotal - discount_total)
    if not tax.enabled:
        return ZERO, net
    if tax.inclusive:
        return q_money(net * tax.rate / (100 + tax.rate)), net
    tax_total = q_money(net * tax.rate / 100)
    return tax_total, q_money(net + tax_total)


def price_order(
    items: list[ItemRequest], variants: dict, options: dict, tax: TaxConfig
) -> PricedOrder:
    priced = tuple(price_item(i, variants.get(i.variant_id), options) for i in items)
    subtotal = q_money(sum((p.line_subtotal for p in priced), ZERO))
    discount = q_money(sum((p.line_discount for p in priced), ZERO))
    tax_total, total = order_totals(subtotal, discount, tax)
    return PricedOrder(priced, subtotal, discount, tax_total, total, tax)
