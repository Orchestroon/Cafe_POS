"""The promotion engine is pure: carts and promotions in, discounts out (spec 8.12)."""

import random
from uuid import uuid4

import pytest

from apps.sales.domain import ItemRequest, TaxConfig
from apps.sales.pricing import price_order
from apps.sales.promotions import allocate
from apps.sales.tests.builders import D, group, option, promo, slot, variant

DRINKS, FOOD = uuid4(), uuid4()
NO_TAX = TaxConfig()


def run(lines, promos=(), selected=(), options=(), tax=NO_TAX):
    """lines: [(variant, qty)] or [(variant, qty, [options])]."""
    reqs = [
        ItemRequest(v.id, q, tuple(o.id for o in (rest[0] if rest else ())))
        for v, q, *rest in lines
    ]
    variants = {v.id: v for v, *_ in lines}
    return price_order(
        reqs, variants, {o.id: o for o in options}, tax, list(promos), frozenset(selected)
    )


def latte(price="60.00"):
    return variant(price, "Small", category_id=DRINKS, name="Latte")


def cake(price="40.00"):
    return variant(price, "Slice", category_id=FOOD, name="Cake")


def amounts(order):
    return [p.line_discount for p in order.items]


def test_no_promotions_changes_nothing():
    o = run([(latte(), 2)])
    assert o.discount_total == D("0.00") and o.total == D("120.00") and o.applied == ()


def test_percentage_on_a_size_is_per_unit_and_leaves_other_items_alone():
    v, c = latte(), cake()
    o = run(
        [(v, 2), (c, 1)],
        [promo(scope="variant", discount_type="percentage", value=20, variant_ids=[v.id])],
    )
    assert amounts(o) == [D("24.00"), D("0.00")]
    assert o.items[0].unit_discount == D("12.00") and o.items[0].line_total == D("96.00")
    assert o.discount_total == D("24.00") and o.total == D("136.00")


def test_fixed_amount_never_goes_below_zero():
    v = latte("30.00")
    o = run(
        [(v, 3)],
        [promo(scope="variant", discount_type="fixed_amount", value=50, variant_ids=[v.id])],
    )
    assert o.total == D("0.00") and o.items[0].line_discount == D("90.00")


def test_category_scope_covers_every_size_of_the_category():
    a, b, c = latte("60.00"), latte("80.00"), cake()
    p = promo(scope="category", discount_type="percentage", value=10, category_ids=[DRINKS])
    assert amounts(run([(a, 1), (b, 1), (c, 1)], [p])) == [D("6.00"), D("8.00"), D("0.00")]


def test_item_promotion_discounts_the_base_price_not_the_extras():
    g = group("Extras", "add", lo=0, hi=1)
    shot = option(g, "Shot", "10.00")
    v = variant("60.00", "Small", [g], category_id=DRINKS)
    p = promo(scope="variant", discount_type="percentage", value=50, variant_ids=[v.id])
    o = run([(v, 1, [shot])], [p], options=[shot])
    assert o.items[0].line_subtotal == D("70.00")
    assert o.items[0].line_discount == D("30.00") and o.total == D("40.00")


def test_the_best_of_two_item_promotions_wins_and_they_do_not_stack():
    v = latte()
    ten = promo(
        name="ten", scope="variant", discount_type="percentage", value=10, variant_ids=[v.id]
    )
    five = promo(
        name="five", scope="variant", discount_type="fixed_amount", value=15, variant_ids=[v.id]
    )
    o = run([(v, 1)], [ten, five])
    assert o.discount_total == D("15.00") and [a["name"] for a in o.applied] == ["five"]


def test_a_tie_goes_to_the_earliest_created_promotion():
    v = latte()
    first = promo(
        name="first", scope="variant", discount_type="fixed_amount", value=6, variant_ids=[v.id]
    )
    second = promo(
        name="second", scope="variant", discount_type="percentage", value=10, variant_ids=[v.id]
    )
    assert [a["name"] for a in run([(v, 1)], [second, first]).applied] == ["first"]


def test_order_promotion_takes_the_whole_subtotal_extras_included():
    g = group("Extras", "add", lo=0, hi=1)
    shot = option(g, "Shot", "10.00")
    v = variant("60.00", "Small", [g], category_id=DRINKS)
    o = run(
        [(v, 1, [shot]), (cake(), 1)],
        [promo(scope="order", discount_type="percentage", value=10)],
        options=[shot],
    )
    assert o.subtotal == D("110.00") and o.discount_total == D("11.00")
    assert sum(amounts(o)) == D("11.00")


def test_order_discount_is_split_so_the_lines_add_up_exactly():
    v = [variant("10.00", f"S{i}", category_id=DRINKS) for i in range(3)]
    o = run(
        [(x, 1) for x in v], [promo(scope="order", discount_type="fixed_amount", value="10.00")]
    )
    assert sum(amounts(o)) == D("10.00") and o.total == D("20.00")
    assert all(a == D("3.33") or a == D("3.34") for a in amounts(o))


def test_order_promotion_is_an_alternative_to_line_promotions_never_added():
    v = latte()
    line = promo(
        name="line", scope="variant", discount_type="percentage", value=10, variant_ids=[v.id]
    )
    order = promo(name="order", scope="order", discount_type="percentage", value=20)
    o = run([(v, 1)], [line, order])
    assert [a["name"] for a in o.applied] == ["order"] and o.discount_total == D("12.00")
    small_order = promo(name="small", scope="order", discount_type="percentage", value=5)
    o = run([(v, 1)], [line, small_order])
    assert [a["name"] for a in o.applied] == ["line"]  # the line deal is bigger
    tie = promo(name="tie", scope="order", discount_type="percentage", value=10)
    assert [a["name"] for a in run([(v, 1)], [line, tie]).applied] == ["line"]  # a tie keeps lines


def test_combo_discounts_the_difference_and_spreads_it_over_its_lines():
    v, c = latte("60.00"), cake("40.00")
    combo = promo(
        "combo", combo_price="80.00", slots=(slot(1, variants=[v]), slot(1, variants=[c]))
    )
    o = run([(v, 1), (c, 1)], [combo])
    assert amounts(o) == [D("12.00"), D("8.00")] and o.total == D("80.00")
    assert o.items[0].promotions[0]["kind"] == "combo"


def test_combo_repeats_for_each_complete_bundle_and_leaves_the_rest_full_price():
    v, c = latte("60.00"), cake("40.00")
    combo = promo(
        "combo", combo_price="80.00", slots=(slot(1, variants=[v]), slot(1, variants=[c]))
    )
    o = run([(v, 3), (c, 2)], [combo])
    assert o.discount_total == D("40.00") and o.total == D("260.00") - D("40.00")
    assert amounts(o) == [D("24.00"), D("16.00")]


def test_combo_that_is_not_cheaper_than_the_items_is_ignored():
    v, c = latte("60.00"), cake("40.00")
    combo = promo(
        "combo", combo_price="100.00", slots=(slot(1, variants=[v]), slot(1, variants=[c]))
    )
    assert run([(v, 1), (c, 1)], [combo]).discount_total == D("0.00")


def test_combo_needs_every_part():
    v, c = latte(), cake()
    combo = promo(
        "combo", combo_price="80.00", slots=(slot(1, variants=[v]), slot(1, variants=[c]))
    )
    assert run([(v, 4)], [combo]).discount_total == D("0.00")


def test_buy_one_get_one_is_a_combo_of_the_same_size():
    v = latte("60.00")
    bogo = promo("combo", combo_price="60.00", slots=(slot(2, variants=[v]),))
    o = run([(v, 3)], [bogo])
    assert o.discount_total == D("60.00") and o.total == D("120.00")


def test_category_parts_take_the_most_expensive_items_first():
    cheap, dear = latte("40.00"), variant("70.00", "Large", category_id=DRINKS, name="Latte")
    c = cake("30.00")
    combo = promo(
        "combo", combo_price="90.00", slots=(slot(1, category_id=DRINKS), slot(1, category_id=FOOD))
    )
    o = run([(cheap, 1), (dear, 1), (c, 1)], [combo])
    assert amounts(o)[0] == D("0.00") and o.discount_total == D("10.00")  # 70 + 30 - 90


def test_combo_extras_are_charged_on_top():
    g = group("Extras", "add", lo=0, hi=1)
    shot = option(g, "Shot", "10.00")
    v = variant("60.00", "Small", [g], category_id=DRINKS)
    c = cake("40.00")
    combo = promo(
        "combo", combo_price="80.00", slots=(slot(1, variants=[v]), slot(1, variants=[c]))
    )
    assert run([(v, 1, [shot]), (c, 1)], [combo], options=[shot]).total == D("90.00")


def test_combo_only_replaces_an_item_discount_when_it_is_better():
    v, c = latte("60.00"), cake("40.00")
    half = promo(
        name="half", scope="variant", discount_type="percentage", value=50, variant_ids=[v.id]
    )
    combo = promo(
        "combo",
        name="combo",
        combo_price="80.00",
        slots=(slot(1, variants=[v]), slot(1, variants=[c])),
    )
    o = run([(v, 1), (c, 1)], [half, combo])  # latte -30 alone, the combo only -20
    assert [a["name"] for a in o.applied] == ["half"] and o.discount_total == D("30.00")
    deep = promo(
        "combo",
        name="deep",
        combo_price="50.00",
        slots=(slot(1, variants=[v]), slot(1, variants=[c])),
    )
    o = run([(v, 1), (c, 1)], [half, deep])  # combo -50 beats -30
    assert [a["name"] for a in o.applied] == ["deep"] and o.discount_total == D("50.00")


def test_a_unit_is_never_in_two_promotions():
    v, c = latte("60.00"), cake("40.00")
    combo = promo(
        "combo", combo_price="80.00", slots=(slot(1, variants=[v]), slot(1, variants=[c]))
    )
    half = promo(scope="variant", discount_type="percentage", value=10, variant_ids=[v.id])
    o = run([(v, 2), (c, 1)], [combo, half])  # one latte in the combo, the other gets the 10 %
    assert o.discount_total == D("20.00") + D("6.00")
    assert sorted(a["kind"] for a in o.applied) == ["combo", "discount"]


def test_manual_promotions_apply_only_when_selected_and_are_offered_as_chips():
    v = latte()
    coupon = promo(
        name="coupon", auto_apply=False, scope="order", discount_type="percentage", value=10
    )
    assert run([(v, 1)], [coupon]).discount_total == D("0.00")
    chips = run([(v, 1)], [coupon]).selectable
    assert [(c["name"], c["selected"], c["gain"]) for c in chips] == [("coupon", False, D("6.00"))]
    o = run([(v, 1)], [coupon], selected=[coupon.id])
    assert o.discount_total == D("6.00") and o.applied[0]["manual"] is True
    assert o.selectable[0]["selected"] is True and o.selectable[0]["gain"] == D("6.00")


def test_a_manual_promotion_that_does_not_help_is_not_offered():
    v = latte()
    big = promo(scope="variant", discount_type="percentage", value=50, variant_ids=[v.id])
    small = promo(
        name="small", auto_apply=False, scope="order", discount_type="percentage", value=5
    )
    assert run([(v, 1)], [big, small]).selectable == ()
    o = run([(v, 1)], [big, small], selected=[small.id])  # tapped, but the 50 % is better
    assert [a["name"] for a in o.applied] == [big.name]
    assert o.selectable[0]["selected"] and o.selectable[0]["gain"] == D("0.00")


def test_unknown_selected_ids_are_ignored():
    v = latte()
    assert run([(v, 1)], [], selected=[uuid4()]).discount_total == D("0.00")


@pytest.mark.parametrize(
    "total,weights",
    [(2, [1, 1, 1]), (1, [5, 5]), (7, [0, 3, 4]), (100, [33, 33, 34]), (5, [2, 2, 2, 2])],
)
def test_allocate_adds_up_and_never_exceeds_a_weight(total, weights):
    shares = allocate(total, weights)
    assert sum(shares) == total and all(s <= w for s, w in zip(shares, weights, strict=True))


def test_random_carts_keep_every_invariant():
    rnd = random.Random(7)
    for _ in range(300):
        vs = [
            variant(
                f"{rnd.randint(0, 9000) / 100:.2f}",
                f"V{i}",
                category_id=rnd.choice([DRINKS, FOOD]),
                name=f"P{i}",
            )
            for i in range(rnd.randint(1, 5))
        ]
        ps = []
        for _ in range(rnd.randint(1, 4)):
            kind = rnd.choice(["discount", "combo", "order"])
            if kind == "combo":
                ps.append(
                    promo(
                        "combo",
                        combo_price=f"{rnd.randint(0, 9000) / 100:.2f}",
                        slots=tuple(
                            slot(rnd.randint(1, 3), category_id=rnd.choice([DRINKS, FOOD]))
                            for _ in range(rnd.randint(1, 2))
                        ),
                    )
                )
            else:
                scope = "order" if kind == "order" else rnd.choice(["variant", "category"])
                ps.append(
                    promo(
                        scope=scope,
                        discount_type=rnd.choice(["percentage", "fixed_amount"]),
                        value=rnd.randint(1, 100),
                        variant_ids=[x.id for x in vs if rnd.random() < 0.5],
                        category_ids=[rnd.choice([DRINKS, FOOD])],
                    )
                )
        o = run([(v, rnd.randint(1, 6)) for v in vs], ps)
        assert o.discount_total == sum(amounts(o)) == sum(a["amount"] for a in o.applied)
        for it in o.items:
            assert D("0.00") <= it.line_discount <= it.line_subtotal
            assert it.line_total == it.line_subtotal - it.line_discount
            assert sum(D(r["amount"]) for r in it.promotions) == it.line_discount
        assert o.total == o.subtotal - o.discount_total >= 0
