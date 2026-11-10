from decimal import Decimal
from uuid import uuid4

import pytest

from apps.core.exceptions import ApiError
from apps.sales.domain import ItemRequest, TaxConfig
from apps.sales.pricing import order_totals, price_order
from apps.sales.tests.builders import D, group, option, variant

NO_TAX = TaxConfig()


def run(items, variants, options=(), tax=NO_TAX):
    return price_order(items, {v.id: v for v in variants}, {o.id: o for o in options}, tax)


def req(v, qty=1, opts=()):
    return ItemRequest(v.id, qty, tuple(o.id for o in opts))


def code(excinfo):
    return excinfo.value.code


def test_plain_item_totals():
    v = variant("65.00")
    o = run([req(v, 2)], [v])
    assert (o.subtotal, o.discount_total, o.tax_total, o.total) == (
        D("130.00"),
        D("0.00"),
        D("0.00"),
        D("130.00"),
    )
    assert o.items[0].unit_price == D("65.00") and o.items[0].line_total == D("130.00")


def test_option_delta_and_per_size_override():
    g = group()
    oat = option(g, "Oat", "15.00", prices=None)
    small = variant("65.00", "Small", [g])
    large = variant("80.00", "Large", [g])
    oat_l = option(g, "Oat L", "15.00", prices={large.id: D("20.00")})
    assert run([req(small, 1, [oat])], [small], [oat]).total == D("80.00")
    # override applies only to the size it names
    assert run([req(large, 1, [oat_l])], [large], [oat_l]).total == D("100.00")
    assert run([req(small, 1, [oat_l])], [small], [oat_l]).total == D("80.00")


def test_modifiers_snapshot_rows():
    g = group("Extras", "add", lo=0, hi=3)
    shot = option(g, "Extra Shot", "20.00")
    v = variant("65.00", groups=[g])
    p = run([req(v, 1, [shot])], [v], [shot]).items[0]
    assert p.modifiers == (
        {
            "group_id": str(g.id),
            "group_name": "Extras",
            "mode": "add",
            "option_id": str(shot.id),
            "option_label": "Extra Shot",
            "price_delta": "20.00",
        },
    )


@pytest.mark.parametrize("qty", [0, -1, 100, "2", 1.5, True, None])
def test_invalid_quantity(qty):
    v = variant()
    with pytest.raises(ApiError) as e:
        run([ItemRequest(v.id, qty)], [v])
    assert code(e) == "INVALID_QUANTITY" and e.value.status == 422


@pytest.mark.parametrize("qty", [1, 99])
def test_quantity_bounds_ok(qty):
    v = variant("1.00")
    assert run([req(v, qty)], [v]).total == D(qty).quantize(D("0.01"))


@pytest.mark.parametrize(
    "kw", [{"active": False}, {"product_active": False}, {"category_active": False}]
)
def test_unavailable_item(kw):
    v = variant(**kw)
    with pytest.raises(ApiError) as e:
        run([req(v)], [v])
    assert code(e) == "ITEM_UNAVAILABLE"


def test_unknown_variant_is_unavailable():
    with pytest.raises(ApiError) as e:
        run([ItemRequest(uuid4(), 1)], [])
    assert code(e) == "ITEM_UNAVAILABLE"


def test_option_must_be_active_linked_and_in_active_group():
    g, other = group(), group("Other")
    v = variant(groups=[g])
    inactive = option(g, "Off", active=False)
    unlinked = option(other, "X")
    off_group = group("Off group", active=False)
    v2 = variant(groups=[off_group])
    in_off_group = option(off_group, "Y")
    for vv, o in [(v, inactive), (v, unlinked), (v2, in_off_group)]:
        with pytest.raises(ApiError) as e:
            run([req(vv, 1, [o])], [vv], [o])
        assert code(e) == "INVALID_MODIFIER"
    with pytest.raises(ApiError) as e:  # unknown option id
        run([ItemRequest(v.id, 1, (uuid4(),))], [v])
    assert code(e) == "INVALID_MODIFIER"


def test_min_max_per_linked_group_including_zero_selection():
    g = group("Size shot", "add", lo=1, hi=2)
    a, b, c = option(g, "A"), option(g, "B"), option(g, "C")
    v = variant(groups=[g])
    with pytest.raises(ApiError) as e:  # min 1, none chosen
        run([req(v)], [v])
    assert code(e) == "MODIFIER_SELECTION_INVALID"
    assert e.value.details["selected"] == 0 and e.value.details["min_select"] == 1
    with pytest.raises(ApiError) as e:  # max 2, three chosen
        run([req(v, 1, [a, b, c])], [v], [a, b, c])
    assert code(e) == "MODIFIER_SELECTION_INVALID"
    assert run([req(v, 1, [a, b])], [v], [a, b]).items  # within range


def test_inactive_linked_group_does_not_block_selling():
    g = group("Old", "add", lo=1, hi=1, active=False)
    v = variant(groups=[g])
    assert run([req(v)], [v]).total == D("65.00")


def test_duplicate_option_ids_rejected():
    g = group("Extras", "add", lo=0, hi=5)
    a = option(g, "A")
    v = variant(groups=[g])
    with pytest.raises(ApiError) as e:
        run([ItemRequest(v.id, 1, (a.id, a.id))], [v], [a])
    assert (
        code(e) == "MODIFIER_SELECTION_INVALID" and e.value.details["reason"] == "duplicate_option"
    )


@pytest.mark.parametrize(
    ("net", "rate", "inclusive", "tax", "total"),
    [
        ("100.00", "14.00", False, "14.00", "114.00"),  # on top
        ("114.00", "14.00", True, "14.00", "114.00"),  # inclusive
        ("10.10", "5.00", False, "0.51", "10.61"),  # 0.505 -> half up
        ("10.05", "5.00", False, "0.50", "10.55"),  # 0.5025 -> 0.50
        ("115.00", "14.00", True, "14.12", "115.00"),  # 115*14/114 = 14.1228
    ],
)
def test_tax_modes(net, rate, inclusive, tax, total):
    t = TaxConfig(True, D(rate), inclusive)
    assert order_totals(D(net), D("0.00"), t) == (D(tax), D(total))


def test_tax_disabled_ignores_rate():
    assert order_totals(D("100.00"), D("0.00"), TaxConfig(False, D("14.00"), False)) == (
        D("0.00"),
        D("100.00"),
    )


def test_order_with_tax_on_top_end_to_end():
    v = variant("80.00")
    o = run([req(v, 3)], [v], tax=TaxConfig(True, D("14.00"), False))
    assert (o.subtotal, o.tax_total, o.total) == (D("240.00"), D("33.60"), D("273.60"))


def test_results_are_decimals_never_floats():
    v = variant("65.00")
    o = run([req(v, 2)], [v])
    assert all(isinstance(x, Decimal) for x in (o.subtotal, o.tax_total, o.total))
