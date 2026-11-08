from decimal import Decimal

import pytest

from apps.core.money import q_cost, q_money, q_qty


def test_money_rounds_half_up_not_bankers():
    assert q_money(Decimal("2.675")) == Decimal("2.68")
    assert q_money(Decimal("2.665")) == Decimal("2.67")
    assert q_money(Decimal("-2.675")) == Decimal("-2.68")


def test_qty_and_cost_precision():
    assert q_qty(Decimal("12.6005")) == Decimal("12.601")
    assert str(q_qty("12.6")) == "12.600"
    assert str(q_cost("1.00005")) == "1.0001"


def test_floats_rejected():
    with pytest.raises(TypeError):
        q_money(1.1)
