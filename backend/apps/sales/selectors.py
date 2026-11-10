"""Who can list which orders (spec section 6). Admin: all. Barista: today's orders (all cashiers)
plus an exact invoice-number lookup for any date. `today` is the organization-local day."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from django.db.models import Sum

from apps.core.policy import has_perm
from apps.core.timeutils import local_date_range, parse_local_date
from apps.tenancy.models import OrganizationSettings

from .models import Order, Payment, RefundLine


def org_timezone(org) -> str:
    return OrganizationSettings.objects.get(organization=org).timezone


def local_today(tz: str) -> date:
    return datetime.now(ZoneInfo(tz)).date()


def today_range(org):
    tz = org_timezone(org)
    today = local_today(tz)
    return local_date_range(today, today, tz)


def payment_totals(shift) -> dict:
    """Per-method sales and refund sums and order count for one shift (used by the shifts app).
    Refunds belong to the shift of the *refunding* user (spec 8.6), not the order's shift."""
    sales = {
        r["method"]: r["total"]
        for r in Payment.objects.filter(shift=shift).values("method").annotate(total=Sum("amount"))
    }
    refunds = {
        r["method"]: r["total"]
        for r in RefundLine.objects.filter(refund__shift=shift)
        .values("method")
        .annotate(total=Sum("amount"))
    }
    return {
        "cash": sales.get("cash"),
        "card": sales.get("card"),
        "cash_refunds": refunds.get("cash"),
        "card_refunds": refunds.get("card"),
        "orders_count": Order.objects.filter(shift=shift).count(),
    }


def list_orders(user, params):
    org = user.organization
    qs = (
        Order.objects.filter(organization=org)
        .select_related("cashier")
        .prefetch_related("payments", "items")
    )
    admin = has_perm(user, "orders.view_all")
    invoice = (params.get("invoice_no") or "").strip()
    if invoice:  # exact lookup, any date, both roles
        qs = qs.filter(invoice_no__iexact=invoice)
    elif admin:
        start_s, end_s = params.get("from"), params.get("to")
        if start_s or end_s:
            tz = org_timezone(org)
            start = parse_local_date(start_s, "from") if start_s else date(2000, 1, 1)
            end = parse_local_date(end_s, "to") if end_s else local_today(tz)
            lo, hi = local_date_range(start, end, tz)
            qs = qs.filter(created_at__gte=lo, created_at__lt=hi)
    else:
        lo, hi = today_range(org)
        qs = qs.filter(created_at__gte=lo, created_at__lt=hi)
    if status := params.get("status"):
        qs = qs.filter(status=status)
    if cashier := params.get("cashier_id"):
        qs = qs.filter(cashier_id=cashier)
    if shift := params.get("shift_id"):
        qs = qs.filter(shift_id=shift)
    return qs.order_by("-created_at", "-invoice_seq")


def get_order(user, pk):
    """Detail/receipt: any order of the organization, by its (unguessable) id. A Barista finds old
    orders through the invoice lookup, then opens them from there."""
    return (
        Order.objects.filter(organization=user.organization, pk=pk)
        .select_related("cashier", "refund__actor")
        .prefetch_related("payments", "items", "refund__lines")
        .first()
    )
