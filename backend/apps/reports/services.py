"""The six read-only reports (spec 8.13). Everything is derived from persisted records.

Dates: orders, their payments and their items use the order's `created_at`; refunds and their lines
use the refund's `created_at`; so `cash_collected + card_collected == collected` and
`cash_refunded + card_refunded == refunds` hold for any period and filter. `cashier_id` filters
orders by their cashier and refunds by the refunding user; `shift_id` filters payments/orders by
their shift and refunds by the refunding user's shift."""

from decimal import Decimal

from django.db.models import Count, F, Max, Q, Sum

from apps.expenses.models import Expense
from apps.inventory.models import StockBalance, StockMovement
from apps.sales.models import Order, OrderItem, Payment, Refund, RefundLine
from apps.shifts.models import CashierShift

ZERO = Decimal("0.00")
S = lambda v: str(v if v is not None else ZERO)  # noqa: E731


def _orders(org, lo, hi, p):
    qs = Order.objects.filter(organization=org, created_at__gte=lo, created_at__lt=hi)
    if p.get("cashier_id"):
        qs = qs.filter(cashier_id=p["cashier_id"])
    if p.get("shift_id"):
        qs = qs.filter(shift_id=p["shift_id"])
    return qs


def _refunds(org, lo, hi, p):
    qs = Refund.objects.filter(organization=org, created_at__gte=lo, created_at__lt=hi)
    if p.get("cashier_id"):
        qs = qs.filter(actor_id=p["cashier_id"])
    if p.get("shift_id"):
        qs = qs.filter(shift_id=p["shift_id"])
    return qs


def sales_summary(org, lo, hi, p) -> dict:
    o = _orders(org, lo, hi, p).aggregate(
        n=Count("id"),
        gross=Sum("subtotal"),
        disc=Sum("discount_total"),
        tax=Sum("tax_total"),
        coll=Sum("total"),
    )
    r = _refunds(org, lo, hi, p).aggregate(n=Count("id"), total=Sum("total_amount"))
    collected, refunds = o["coll"] or ZERO, r["total"] or ZERO
    return {
        "orders_count": o["n"],
        "gross_sales": S(o["gross"]),
        "discounts": S(o["disc"]),
        "tax": S(o["tax"]),
        "collected": S(collected),
        "refunds": S(refunds),
        "net_sales": S(collected - refunds),
        "refunded_orders_count": r["n"],
    }


def payment_breakdown(org, lo, hi, p) -> dict:
    pay = {
        r["method"]: r["t"]
        for r in Payment.objects.filter(order__in=_orders(org, lo, hi, p))
        .values("method")
        .annotate(t=Sum("amount"))
    }
    ref = {
        r["method"]: r["t"]
        for r in RefundLine.objects.filter(refund__in=_refunds(org, lo, hi, p))
        .values("method")
        .annotate(t=Sum("amount"))
    }
    out = {}
    for m in ("cash", "card"):
        c, r = pay.get(m) or ZERO, ref.get(m) or ZERO
        out[f"{m}_collected"], out[f"{m}_refunded"], out[f"{m}_net"] = S(c), S(r), S(c - r)
    return {
        k: out[k]
        for k in (
            "cash_collected",
            "card_collected",
            "cash_refunded",
            "card_refunded",
            "cash_net",
            "card_net",
        )
    }


TOP_PRODUCTS_LIMIT = 100
# Expenses have no cashier, and purchases/external expenses no shift, so these filters would
# silently drop rows (spec 8.13, Q6 item 3A): the report refuses them instead.
NO_PERSON_FILTER = {"purchases-expenses"}


def top_products(org, lo, hi, p) -> dict:
    qs = (
        OrderItem.objects.filter(order__in=_orders(org, lo, hi, p), order__status="paid")
        .values("variant_id")
        .annotate(
            product_name_snapshot=Max("product_name_snapshot"),
            variant_label_snapshot=Max("variant_label_snapshot"),
            qty_sold=Sum("quantity"),
            net_revenue=Sum("line_total"),
        )
    )
    key = "qty_sold" if p.get("ordering") == "qty" else "net_revenue"
    rows = list(qs.order_by(f"-{key}", "product_name_snapshot")[: TOP_PRODUCTS_LIMIT + 1])
    truncated = len(rows) > TOP_PRODUCTS_LIMIT
    rows = rows[:TOP_PRODUCTS_LIMIT]
    return {
        "truncated": truncated,
        "products": [
            {
                "variant_id": str(r["variant_id"]),
                "product_name_snapshot": r["product_name_snapshot"],
                "variant_label_snapshot": r["variant_label_snapshot"],
                "qty_sold": r["qty_sold"],
                "net_revenue": S(r["net_revenue"]),
            }
            for r in rows
        ],
    }


def stock(org, lo, hi, p) -> dict:
    consumed = {
        r["ingredient_id"]: r["t"]
        for r in StockMovement.objects.filter(
            organization=org,
            movement_type="sale",
            occurred_at__gte=lo,
            occurred_at__lt=hi,
        )
        .values("ingredient_id")
        .annotate(t=Sum(-F("qty_delta")))
    }
    rows = (
        StockBalance.objects.filter(organization=org, ingredient__is_active=True)
        .select_related("ingredient")
        .order_by("ingredient__name")
    )
    items = []
    for b in rows:
        th = b.ingredient.low_stock_threshold
        items.append(
            {
                "ingredient_id": str(b.ingredient_id),
                "name": b.ingredient.name,
                "unit": b.ingredient.base_unit,
                "balance": str(b.qty),
                "threshold": None if th is None else str(th),
                "is_low": th is not None and b.qty <= th,
                "is_negative": b.qty < 0,
                "consumed_qty_period": str(consumed.get(b.ingredient_id) or Decimal("0.000")),
            }
        )
    return {"ingredients": items}


def purchases_expenses(org, lo, hi, p) -> dict:
    qs = Expense.objects.filter(organization=org, status="posted", paid_at__gte=lo, paid_at__lt=hi)

    def total(q=None):
        return S((qs.filter(q) if q else qs).aggregate(t=Sum("amount"))["t"])

    breakdown = qs.values("category").annotate(t=Sum("amount")).order_by("-t", "category")
    return {
        "purchase_total": total(Q(type="purchase")),
        "general_expenses_total": total(Q(type="general")),
        "cash_drawer_total": total(Q(source="cash_drawer")),
        "external_total": total(Q(source="external")),
        "breakdown": [{"category": r["category"], "total": S(r["t"])} for r in breakdown],
    }


def shifts(org, lo, hi, p) -> dict:
    qs = CashierShift.objects.filter(
        organization=org, opened_at__gte=lo, opened_at__lt=hi
    ).select_related("user")
    if p.get("cashier_id"):
        qs = qs.filter(user_id=p["cashier_id"])
    if p.get("shift_id"):
        qs = qs.filter(pk=p["shift_id"])
    qs = qs.annotate(n_orders=Count("orders")).order_by("-opened_at")
    rows = list(qs)
    closed = [s for s in rows if s.status == "closed"]
    ts = lambda dt: dt.isoformat().replace("+00:00", "Z") if dt else None  # noqa: E731
    opt = lambda v: None if v is None else str(v)  # noqa: E731
    return {
        "shifts_count": len(rows),
        "open_count": len(rows) - len(closed),
        "closed_count": len(closed),
        "expected_cash_total": S(sum((s.expected_cash for s in closed), ZERO)),
        "actual_cash_total": S(sum((s.actual_cash for s in closed), ZERO)),
        "total_difference": S(sum((s.difference for s in closed), ZERO)),
        "shifts": [
            {
                "id": str(s.pk),
                "user": {
                    "id": str(s.user_id),
                    "display_name": s.user.display_name or s.user.username,
                },
                "status": s.status,
                "opened_at": ts(s.opened_at),
                "closed_at": ts(s.closed_at),
                "opening_cash": str(s.opening_cash),
                "expected": opt(s.expected_cash),
                "actual": opt(s.actual_cash),
                "difference": opt(s.difference),
                "orders_count": s.n_orders,
            }
            for s in rows
        ],
    }


REPORTS = {
    "sales-summary": sales_summary,
    "payment-breakdown": payment_breakdown,
    "top-products": top_products,
    "stock": stock,
    "purchases-expenses": purchases_expenses,
    "shifts": shifts,
}
