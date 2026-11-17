from datetime import date
from decimal import Decimal

from django.db.models import Sum

from apps.core.timeutils import local_date_range, parse_local_date
from apps.expenses.selectors import drawer_total
from apps.sales.selectors import local_today, org_timezone, payment_totals

from .models import CashierShift, CashMovement

ZERO = Decimal("0.00")


def cash_moved(shift) -> tuple[Decimal, Decimal]:
    """Posted (not voided) cash put in and taken out of this shift's drawer."""
    rows = (
        CashMovement.objects.filter(shift=shift, status=CashMovement.Status.POSTED)
        .values("kind")
        .annotate(t=Sum("amount"))
    )
    by_kind = {r["kind"]: r["t"] for r in rows}
    return by_kind.get("in") or ZERO, by_kind.get("out") or ZERO


def live_totals(shift) -> dict:
    """Figures computed from persisted records. Spec 8.5: expected cash = opening + cash sales
    - cash refunds (refunds made from this shift) - posted drawer expenses of this shift
    + cash put in - cash taken out (owner, 2026-11-16)."""
    t = payment_totals(shift)
    cash, card = t["cash"] or ZERO, t["card"] or ZERO
    cash_refunds, card_refunds = t["cash_refunds"] or ZERO, t["card_refunds"] or ZERO
    drawer = drawer_total(shift)
    cash_in, cash_out = cash_moved(shift)
    return {
        "cash_sales": str(cash),
        "card_sales": str(card),
        "cash_refunds": str(cash_refunds),
        "card_refunds": str(card_refunds),
        "drawer_expenses": str(drawer),
        "cash_in": str(cash_in),
        "cash_out": str(cash_out),
        "orders_count": t["orders_count"],
        "expected_cash": str(
            shift.opening_cash + cash - cash_refunds - drawer + cash_in - cash_out
        ),
    }


def cash_movement_dict(m) -> dict:
    return {
        "id": str(m.pk),
        "shift_id": str(m.shift_id),
        "kind": m.kind,
        "amount": str(m.amount),
        "reason": m.reason,
        "status": m.status,
        "created_at": _ts(m.created_at),
        "created_by": _name(m.created_by),
        "void_reason": m.void_reason,
        "voided_at": _ts(m.voided_at),
        "voided_by": _name(m.voided_by) if m.voided_by_id else None,
    }


def previous_close(shift):
    """The same user's last close before this shift opened, or None (gap between shifts)."""
    return (
        CashierShift.objects.filter(
            user_id=shift.user_id, status=CashierShift.Status.CLOSED, closed_at__lte=shift.opened_at
        )
        .order_by("-closed_at")
        .only("pk", "closed_at", "actual_cash")
        .first()
    )


def gap(shift, prev) -> dict | None:
    """Opening cash vs the previous counted close: negative = cash left the drawer between
    shifts, positive = cash was added. None when there is no earlier close."""
    if prev is None:
        return None
    return {
        "previous_shift_id": str(prev.pk),
        "previous_closed_at": _ts(prev.closed_at),
        "previous_actual_cash": str(prev.actual_cash),
        "difference": str(shift.opening_cash - prev.actual_cash),
    }


def _ts(dt):
    return dt.isoformat().replace("+00:00", "Z") if dt else None


def _name(u):
    return {"id": str(u.pk), "display_name": u.display_name or u.username}


def shift_payload(shift, detail=True) -> dict:
    """Open shifts show live totals; closed shifts show the frozen `totals_snapshot`. The list
    (detail=False) leaves out the cash movements and the gap since the previous close."""
    closed = shift.status == CashierShift.Status.CLOSED
    out = {
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
    if detail:
        out["cash_movements"] = [
            cash_movement_dict(m)
            for m in shift.cash_movements.select_related("created_by", "voided_by")
        ]
        out["since_previous_close"] = gap(shift, previous_close(shift))
    return out


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
