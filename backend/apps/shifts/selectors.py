from decimal import Decimal

from apps.sales.selectors import payment_totals

ZERO = Decimal("0.00")


def live_totals(shift) -> dict:
    """Live figures for an open shift. Refunds and drawer expenses arrive in Sprint 3."""
    t = payment_totals(shift)
    cash, card = t["cash"] or ZERO, t["card"] or ZERO
    return {
        "cash_sales": str(cash),
        "card_sales": str(card),
        "cash_refunds": str(ZERO),
        "card_refunds": str(ZERO),
        "drawer_expenses": str(ZERO),
        "orders_count": t["orders_count"],
        "expected_cash": str(shift.opening_cash + cash),
    }


def shift_payload(shift) -> dict:
    return {
        "id": str(shift.pk),
        "status": shift.status,
        "opening_cash": str(shift.opening_cash),
        "opened_at": shift.opened_at.isoformat().replace("+00:00", "Z"),
        "user": {
            "id": str(shift.user_id),
            "display_name": shift.user.display_name or shift.user.username,
        },
        "register": shift.register.name,
        "totals": live_totals(shift),
    }
