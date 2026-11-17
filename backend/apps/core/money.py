"""The only place where money and quantities are rounded (ROUND_HALF_UP). No floats."""

from decimal import ROUND_HALF_UP, Decimal

_MONEY = Decimal("0.01")
_QTY = Decimal("0.001")
_COST = Decimal("0.0001")
_AVG = Decimal("0.000001")  # average cost per base unit (g, ml, pcs)


def _q(value, exp):
    if isinstance(value, float):
        raise TypeError("float is not allowed in money/quantity paths")
    return Decimal(value).quantize(exp, rounding=ROUND_HALF_UP)


def q_money(value) -> Decimal:
    return _q(value, _MONEY)


def q_qty(value) -> Decimal:
    return _q(value, _QTY)


def q_cost(value) -> Decimal:
    return _q(value, _COST)


def q_avg(value) -> Decimal:
    return _q(value, _AVG)
