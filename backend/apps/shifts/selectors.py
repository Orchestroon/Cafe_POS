from datetime import date
from decimal import Decimal

from apps.core.timeutils import local_date_range, parse_local_date
from apps.expenses.selectors import drawer_total
from apps.sales.selectors import local_today, org_timezone, payment_totals

from .models import CashierShift

ZERO = Decimal("0.00")


def live_totals(shift) -> dict:
    """Figures computed from persisted records. Spec 8.5: expected cash = opening + cash sales
    - cash refunds (refunds made from this shift) - posted drawer expenses of this shift."""
    t = payment_totals(shift)
    cash, card = t["cash"] or ZERO, t["card"] or ZERO
    cash_refunds, card_refunds = t["cash_refunds"] or ZERO, t["card_refunds"] or ZERO
    drawer = drawer_total(shift)
    return {
        "cash_sales": str(cash),
        "card_sales": str(card),
        "cash_refunds": str(cash_refunds),
        "card_refunds": str(card_refunds),
        "drawer_expenses": str(drawer),
        "orders_count": t["orders_count"],
        "expected_cash": str(shift.opening_cash + cash - cash_refunds - drawer),
    }


def _ts(dt):
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def _name(u):
    return {"id": str(u.pk), "display_name": u.display_name or u.username}


def shift_payload(shift) -> dict:
    """Open shifts show live totals; closed shifts show the frozen `totals_snapshot`."""
    closed = shift.status == CashierShift.Status.CLOSED
    return {
        "id": str(shift.pk),
        "status": shift.status,
        "opening_cash": str(shift.opening_cash),
        "opened_at": _ts(shift.opened_at),
        "closed_at": _ts(shift.closed_at),
        "closed_by": _name(shift.closed_by) if shift.closed_by_id else None,
        "user": _name(shift.user),
        "register": shift.register.name,
        "expected_cash": None if shift.expected_cash is None else str(shift.expected_cash),
        "actual_cash": None if shift.actual_cash is None else str(shift.actual_cash),
        "difference": None if shift.difference is None else str(shift.difference),
        "close_note": shift.close_note,
        "totals": shift.totals_snapshot if closed else live_totals(shift),
    }


def list_shifts(org, params):
    qs = CashierShift.objects.filter(organization=org).select_related(
        "user", "register", "closed_by"
    )
    if user_id := params.get("user_id"):
        qs = qs.filter(user_id=user_id)
    if status := params.get("status"):
        qs = qs.filter(status=status)
    if params.get("from") or params.get("to"):
        tz = org_timezone(org)
        start = parse_local_date(params["from"], "from") if params.get("from") else None
        end = parse_local_date(params["to"], "to") if params.get("to") else local_today(tz)
        lo, hi = local_date_range(start or date(2000, 1, 1), end, tz)
        qs = qs.filter(opened_at__gte=lo, opened_at__lt=hi)
    return qs.order_by("-opened_at")
