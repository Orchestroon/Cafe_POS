from decimal import Decimal

import pytest

from apps.core.exceptions import ApiError
from apps.sales.consumption import aggregate, consume_item, stock_warnings
from apps.sales.domain import ItemRequest, TaxConfig
from apps.sales.pricing import price_order
from apps.sales.tests.builders import D, effect, group, ingredient, line, option, variant

COFFEE, MILK, OAT, CUP = (
    ingredient("Coffee", "g"),
    ingredient("Milk", "ml"),
    ingredient("Oat Milk", "ml"),
    ingredient("Cup", "pcs"),
)


def consume(v, qty=1, opts=()):
    options = {o.id: o for o in opts}
    priced = price_order(
        [ItemRequest(v.id, qty, tuple(o.id for o in opts))], {v.id: v}, options, TaxConfig()
    ).items[0]
    return consume_item(priced)


def totals(c):
    return {r["ingredient_name"]: (r["qty_per_unit"], r["total_qty"]) for r in c.per_ingredient}


def test_at03_waste_applied_once_exact():
    v = variant(recipe=[line(COFFEE, "12", "5", "coffee")])
    assert totals(consume(v, 1)) == {"Coffee": ("12.600", "12.600")}
    assert totals(consume(v, 2)) == {"Coffee": ("12.600", "25.200")}


def test_at02_small_and_large_consume_differently():
    small = variant("65.00", "Small", recipe=[line(COFFEE, "12", "5", "coffee"), line(MILK, "200")])
    large = variant("80.00", "Large", recipe=[line(COFFEE, "18", "5", "coffee"), line(MILK, "300")])
    assert totals(consume(small)) == {
        "Coffee": ("12.600", "12.600"),
        "Milk": ("200.000", "200.000"),
    }
    assert totals(consume(large)) == {
        "Coffee": ("18.900", "18.900"),
        "Milk": ("300.000", "300.000"),
    }


def test_at04_oat_replaces_milk_regular_not_deducted():
    g = group("Milk Type", "replace", "milk")
    oat = option(g, "Oat", effects=[effect(OAT, "250")])
    v = variant(
        groups=[g], recipe=[line(COFFEE, "12", "5", "coffee"), line(MILK, "250", "0", "milk")]
    )
    c = consume(v, 1, [oat])
    assert totals(c) == {"Coffee": ("12.600", "12.600"), "Oat Milk": ("250.000", "250.000")}
    assert "Milk" not in totals(c)
    assert {w.source for w in c.lines} == {"recipe", "modifier"}


def test_at05_extra_shot_adds_coffee_on_top_of_recipe_coffee():
    g = group("Extras", "add", lo=0, hi=3)
    shot = option(g, "Extra Shot", "20.00", effects=[effect(COFFEE, "8", "5")])
    v = variant(groups=[g], recipe=[line(COFFEE, "12", "5", "coffee")])
    c = consume(v, 1, [shot])
    assert totals(c) == {"Coffee": ("21.000", "21.000")}  # 12.6 + 8.4
    assert consume(v, 2, [shot]).per_ingredient[0]["total_qty"] == "42.000"


def test_replace_slot_missing_is_invalid_modifier():
    g = group("Milk Type", "replace", "milk")
    oat = option(g, "Oat", effects=[effect(OAT, "250")])
    v = variant(groups=[g], recipe=[line(COFFEE, "12", "0", "coffee")])
    with pytest.raises(ApiError) as e:
        consume(v, 1, [oat])
    assert e.value.code == "INVALID_MODIFIER" and e.value.details["reason"] == "slot_missing"


def test_no_milk_option_with_zero_effects_removes_the_slot():
    g = group("Milk Type", "replace", "milk")
    none = option(g, "No milk")
    v = variant(
        groups=[g], recipe=[line(COFFEE, "12", "0", "coffee"), line(MILK, "250", "0", "milk")]
    )
    assert totals(consume(v, 1, [none])) == {"Coffee": ("12.000", "12.000")}


def test_size_specific_effect_beats_all_sizes_and_other_size_only_is_invalid():
    g = group("Extras", "add", lo=0, hi=3)
    small = variant("65.00", "Small", groups=[g])
    large = variant("80.00", "Large", groups=[g])
    opt = option(
        g,
        "Shot",
        effects=[
            effect(COFFEE, "8", variant_id=small.id),
            effect(COFFEE, "11", variant_id=None),
        ],
    )
    assert totals(consume(small, 1, [opt])) == {"Coffee": ("8.000", "8.000")}  # specific only
    assert totals(consume(large, 1, [opt])) == {"Coffee": ("11.000", "11.000")}  # all sizes
    only_small = option(g, "Only small", effects=[effect(COFFEE, "5", variant_id=small.id)])
    with pytest.raises(ApiError) as e:
        consume(large, 1, [only_small])
    assert (
        e.value.code == "INVALID_MODIFIER" and e.value.details["reason"] == "no_effect_for_variant"
    )
    assert totals(consume(small, 1, [only_small])) == {"Coffee": ("5.000", "5.000")}


def test_slot_removed_once_even_with_two_options_in_the_group():
    g = group("Milk Type", "replace", "milk", lo=0, hi=2)
    a = option(g, "Half oat", effects=[effect(OAT, "125")])
    b = option(g, "Half whole", effects=[effect(MILK, "125")])
    v = variant(groups=[g], recipe=[line(MILK, "250", "0", "milk")])
    assert totals(consume(v, 1, [a, b])) == {
        "Oat Milk": ("125.000", "125.000"),
        "Milk": ("125.000", "125.000"),
    }


def test_per_unit_rounding_then_multiply():
    v = variant(recipe=[line(COFFEE, "0.001", "50")])  # 0.0015 -> 0.002 per unit (half up)
    assert totals(consume(v, 3)) == {"Coffee": ("0.002", "0.006")}


def test_zero_quantity_lines_are_omitted_from_consumption():
    v = variant(recipe=[line(COFFEE, "0"), line(CUP, "1")])
    assert totals(consume(v)) == {"Cup": ("1.000", "1.000")}


def test_untracked_size_with_empty_recipe_consumes_nothing():
    assert consume(variant(track=False)).per_ingredient == ()


def test_b3_tracked_size_without_recipe_is_refused():
    with pytest.raises(ApiError) as e:
        consume(variant(label="Water", track=True))
    assert e.value.code == "RECIPE_MISSING" and e.value.status == 422
    assert e.value.details["variant_label"] == "Water"


def test_r2_tracked_option_without_effects_is_refused_untracked_deducts_nothing():
    g = group("Extras", "add", lo=0, hi=3)
    v = variant(groups=[g], recipe=[line(COFFEE, "10")])
    bare = option(g, "Caramel", track=True)
    with pytest.raises(ApiError) as e:
        consume(v, 1, [bare])
    assert e.value.code == "INVALID_MODIFIER" and e.value.details["reason"] == "no_effect"
    no_ice = option(g, "No ice", track=False)
    assert totals(consume(v, 1, [no_ice])) == {"Coffee": ("10.000", "10.000")}


def test_aggregate_across_items_and_warnings_never_block():
    v1 = variant(recipe=[line(COFFEE, "12", "5"), line(CUP, "1")])
    v2 = variant(recipe=[line(COFFEE, "10")])
    c = [consume(v1, 2), consume(v2, 1)]
    req = aggregate(c)
    assert req[str(COFFEE["id"])]["required"] == D("35.200")  # 25.2 + 10
    avail = {str(COFFEE["id"]): D("30.000"), str(CUP["id"]): D("5.000")}
    w = stock_warnings(req, avail)
    assert w == [
        {
            "ingredient_id": str(COFFEE["id"]),
            "ingredient_name": "Coffee",
            "unit": "g",
            "available": "30.000",
            "required": "35.200",
            "projected_balance": "-5.200",
        }
    ]
    assert stock_warnings(req, {str(COFFEE["id"]): D("35.200"), str(CUP["id"]): D("2")}) == []
    assert isinstance(req[str(CUP["id"])]["required"], Decimal)


def test_already_negative_balance_warns_and_unknown_balance_counts_as_zero():
    v = variant(recipe=[line(COFFEE, "1")])
    req = aggregate([consume(v)])
    w = stock_warnings(req, {str(COFFEE["id"]): D("-3.000")})
    assert w[0]["projected_balance"] == "-4.000"
    assert stock_warnings(req, {})[0]["available"] == "0.000"
