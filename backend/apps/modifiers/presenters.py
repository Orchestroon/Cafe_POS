"""Plain dict builders for modifier groups/options, shared by the modifier API and the products API.
Expects `options`, `prices` (and `effects` for admins) to be prefetched."""


def option_dict(opt, *, effects=False):
    out = {
        "id": str(opt.pk),
        "label": opt.label,
        "price_delta": str(opt.price_delta),
        "sort_order": opt.sort_order,
        "is_active": opt.is_active,
        "track_stock": opt.track_stock,
        "variant_prices": [
            {"variant_id": str(p.variant_id), "price_delta": str(p.price_delta)}
            for p in opt.prices.all()
        ],
    }
    if effects:
        out["effects"] = [
            {
                "variant_id": str(e.variant_id) if e.variant_id else None,
                "ingredient_id": str(e.ingredient_id),
                "ingredient_name": e.ingredient.name,
                "unit": e.ingredient.base_unit,
                "base_qty": str(e.base_qty),
                "waste_pct": str(e.waste_pct),
            }
            for e in opt.effects.all()
        ]
    return out


def options_list(group, *, include_inactive=False, effects=False):
    return [
        option_dict(o, effects=effects)
        for o in group.options.all()
        if include_inactive or o.is_active
    ]
