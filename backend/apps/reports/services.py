"""The six read-only reports (spec 8.13). Everything is derived from persisted records.

Dates: orders, their payments and their items use the order's `created_at`; refunds and their lines
use the refund's `created_at`; so `cash_collected + card_collected == collected` and
`cash_refunded + card_refunded == refunds` hold for any period and filter. `cashier_id` filters
orders by their cashier and refunds by the refunding user; `shift_id` filters payments/orders by
their shift and refunds by the refunding user's shift."""

from decimal import Decimal

from django.db.models import (
    Count,
    DecimalField,
    ExpressionWrapper,
    F,
    Max,
    OuterRef,
    Q,
    Subquery,
    Sum,
)

from apps.core.money import q_money
from apps.expenses.models import Expense
from apps.inventory.models import StockBalance, StockMovement
from apps.inventory.services import unit_cost
from apps.purchasing.models import Purchase
from apps.sales.models import Order, OrderItem, OrderPromotion, Payment, Refund, RefundLine
from apps.shifts.models import CashierShift, CashMovement

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
NO_PERSON_FILTER = {"purchases-expenses", "money-in-out", "profit"}


def _per_variant(qs):
    return {
        r["variant_id"]: r
        for r in qs.values("variant_id").annotate(
            product_name_snapshot=Max("product_name_snapshot"),
            variant_label_snapshot=Max("variant_label_snapshot"),
            qty=Sum("quantity"),
            revenue=Sum("line_total"),
        )
    }


def top_products(org, lo, hi, p) -> dict:
    """Same rule as the sales summary (money review, 2026-11-16): an item counts on the day it was
    sold, and comes off on the day its order was refunded, so a past period never changes.
    Revenue is line totals (before tax)."""
    sold = _per_variant(OrderItem.objects.filter(order__in=_orders(org, lo, hi, p)))
    back = _per_variant(OrderItem.objects.filter(order__refund__in=_refunds(org, lo, hi, p)))
    rows = []
    for vid in sold.keys() | back.keys():
        s_, b_ = sold.get(vid, {}), back.get(vid, {})
        names = s_ or b_
        sold_qty, back_qty = s_.get("qty") or 0, b_.get("qty") or 0
        revenue, refunded = s_.get("revenue") or ZERO, b_.get("revenue") or ZERO
        rows.append(
            {
                "variant_id": str(vid),
                "product_name_snapshot": names["product_name_snapshot"],
                "variant_label_snapshot": names["variant_label_snapshot"],
                "qty_sold": sold_qty,
                "qty_refunded": back_qty,
                "refunded_revenue": S(refunded),
                "net_revenue": S(revenue - refunded),
                "_net_qty": sold_qty - back_qty,
                "_net": revenue - refunded,
            }
        )
    key = "_net_qty" if p.get("ordering") == "qty" else "_net"
    rows.sort(key=lambda r: (-r[key], r["product_name_snapshot"]))
    truncated = len(rows) > TOP_PRODUCTS_LIMIT
    for r in rows:
        del r["_net_qty"], r["_net"]
    return {"truncated": truncated, "products": rows[:TOP_PRODUCTS_LIMIT]}


def stock(org, lo, hi, p) -> dict:
    """Balances are current; the date range (and, Sprint 5 P11, a cashier or shift) only narrow
    the consumed column: sales made by that cashier / in that shift."""
    sales = StockMovement.objects.filter(
        organization=org, movement_type="sale", occurred_at__gte=lo, occurred_at__lt=hi
    )
    if p.get("cashier_id") or p.get("shift_id"):
        orders = Order.objects.filter(organization=org)
        if p.get("cashier_id"):
            orders = orders.filter(cashier_id=p["cashier_id"])
        if p.get("shift_id"):
            orders = orders.filter(shift_id=p["shift_id"])
        sales = sales.filter(source_id__in=OrderItem.objects.filter(order__in=orders).values("pk"))
    consumed = {
        r["ingredient_id"]: r["t"]
        for r in sales.values("ingredient_id").annotate(t=Sum(-F("qty_delta")))
    }
    # A switched-off ingredient stays listed while it still holds stock (money review).
    rows = (
        StockBalance.objects.filter(organization=org)
        .filter(Q(ingredient__is_active=True) | ~Q(qty=0))
        .select_related("ingredient")
        .order_by("ingredient__name")
    )
    items, total, no_cost = [], ZERO, 0
    for b in rows:
        th = b.ingredient.low_stock_threshold
        uc = unit_cost(b)
        value = None if uc is None else q_money(b.qty * uc)
        if value is None:
            no_cost += 1
        else:
            total += value
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
                "is_active": b.ingredient.is_active,
                "unit_cost": None if uc is None else str(uc),
                "value": None if value is None else str(value),
            }
        )
    return {"ingredients": items, "stock_value": S(total), "without_cost_count": no_cost}


def purchases_expenses(org, lo, hi, p) -> dict:
    qs = Expense.objects.filter(organization=org, status="posted", paid_at__gte=lo, paid_at__lt=hi)

    def total(q=None):
        return S((qs.filter(q) if q else qs).aggregate(t=Sum("amount"))["t"])

    breakdown = qs.values("category").annotate(t=Sum("amount")).order_by("-t", "category")
    return {
        # money paid for purchases: paid at post, or later by supplier payments (Sprint 5 P4)
        "purchase_total": total(Q(type__in=("purchase", "supplier_payment"))),
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
    prev = CashierShift.objects.filter(
        user_id=OuterRef("user_id"), status="closed", closed_at__lte=OuterRef("opened_at")
    ).order_by("-closed_at")
    moved = lambda kind: Subquery(  # noqa: E731
        CashMovement.objects.filter(shift=OuterRef("pk"), status="posted", kind=kind)
        .values("shift")
        .annotate(t=Sum("amount"))
        .values("t")
    )
    qs = qs.annotate(
        n_orders=Count("orders"),
        prev_actual=Subquery(prev.values("actual_cash")[:1]),
        cash_in=moved("in"),
        cash_out=moved("out"),
    ).order_by("-opened_at")
    rows = list(qs)
    gaps = [s.opening_cash - s.prev_actual for s in rows if s.prev_actual is not None]
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
        "cash_in_total": S(sum((s.cash_in or ZERO for s in rows), ZERO)),
        "cash_out_total": S(sum((s.cash_out or ZERO for s in rows), ZERO)),
        "gap_total": S(sum(gaps, ZERO)),
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
                "cash_in": S(s.cash_in),
                "cash_out": S(s.cash_out),
                "previous_actual": opt(s.prev_actual),
                "gap": None if s.prev_actual is None else str(s.opening_cash - s.prev_actual),
            }
            for s in rows
        ],
    }


METHODS = ("cash", "card", "transfer")


def _by_method(qs, field="payment_method", amount="amount") -> dict:
    got = {r[field]: r["t"] for r in qs.values(field).annotate(t=Sum(amount))}
    return {m: got.get(m) or ZERO for m in METHODS}


def _row(key, direction, amounts) -> dict:
    return {
        "key": key,
        "direction": direction,
        **{m: S(amounts[m]) for m in METHODS},
        "total": S(sum(amounts.values(), ZERO)),
    }


def money_in_out(org, lo, hi, p) -> dict:
    """Every pound in and out for the period (owner, 2026-11-16), by how it was paid.
    In: sales (by order date). Out: refunds (by refund date), expenses and purchases (by paid
    date; voided ones excluded). Cash put in / taken out of drawers only moves cash, so it is
    listed apart and never counted as in or out."""
    orders, refunds = _orders(org, lo, hi, p), _refunds(org, lo, hi, p)
    exp = Expense.objects.filter(organization=org, status="posted", paid_at__gte=lo, paid_at__lt=hi)
    rows = [
        _row("sales", "in", _by_method(Payment.objects.filter(order__in=orders), "method")),
        _row("refunds", "out", _by_method(RefundLine.objects.filter(refund__in=refunds), "method")),
        _row(
            "drawer_expenses", "out", _by_method(exp.filter(type="general", source="cash_drawer"))
        ),
        _row("other_expenses", "out", _by_method(exp.filter(type="general", source="external"))),
        _row(
            "drawer_purchases", "out", _by_method(exp.filter(type="purchase", source="cash_drawer"))
        ),
        _row("other_purchases", "out", _by_method(exp.filter(type="purchase", source="external"))),
        # Sprint 5 P4: credit purchases go out on the day they are paid, not when posted.
        _row(
            "drawer_supplier_payments",
            "out",
            _by_method(exp.filter(type="supplier_payment", source="cash_drawer")),
        ),
        _row(
            "other_supplier_payments",
            "out",
            _by_method(exp.filter(type="supplier_payment", source="external")),
        ),
        # Sprint 5 Q-C: what the bank keeps from card sales (by sale date, like the sales)
        _row(
            "card_fees",
            "out",
            _by_method(Payment.objects.filter(order__in=orders), "method", "fee_amount"),
        ),
    ]
    tot = {}
    for d in ("in", "out"):
        tot[d] = {
            m: sum((Decimal(r[m]) for r in rows if r["direction"] == d), ZERO) for m in METHODS
        }
    net = {m: tot["in"][m] - tot["out"][m] for m in METHODS}
    moves = {
        r["kind"]: r["t"]
        for r in CashMovement.objects.filter(
            organization=org, status="posted", created_at__gte=lo, created_at__lt=hi
        )
        .values("kind")
        .annotate(t=Sum("amount"))
    }
    shift_rows = shifts(org, lo, hi, {})
    return {
        "rows": rows,
        "total_in": _row("total_in", "in", tot["in"]),
        "total_out": _row("total_out", "out", tot["out"]),
        "net": _row("net", "net", net),
        "drawer": {
            "cash_in": S(moves.get("in")),
            "cash_out": S(moves.get("out")),
            "gap_total": shift_rows["gap_total"],
            "closed_count": shift_rows["closed_count"],
            "total_difference": shift_rows["total_difference"],
        },
    }


_VALUE = ExpressionWrapper(
    F("qty_delta") * F("unit_cost"), output_field=DecimalField(max_digits=28, decimal_places=9)
)


def profit(org, lo, hi, p) -> dict:
    """What the sales earned (owner, 2026-11-17: "I sell for 100, all my costs are 90, so I made
    10"). Net sales (before tax, minus refunds by refund date) - cost of what was sold (saved on
    each order at sale time) = gross profit; - losses (stock taken out: waste, broken, count
    shortages, valued at average cost) - expenses (rent, salaries, bills...) = net profit.
    Purchases are not subtracted: they become stock and are counted when sold or lost. Stock that
    comes in is never profit (Sprint 5 L2/L3): an opening balance, a count surplus, or an old
    positive adjustment only show as information. Refunded orders keep their cost (the
    ingredients were used; D8). Unknown costs are never 0: cost / gross / margin / net are None
    when an order has no cost (old data, D20), net is None when a loss has no cost."""
    orders = Order.objects.filter(organization=org, created_at__gte=lo, created_at__lt=hi)
    ex_tax = F("total") - F("tax_total")
    o = orders.aggregate(rev=Sum(ex_tax), cost=Sum("cost_total"))
    missing = orders.filter(cost_total__isnull=True).aggregate(n=Count("id"), rev=Sum(ex_tax))
    back = Order.objects.filter(
        organization=org, refund__created_at__gte=lo, refund__created_at__lt=hi
    ).aggregate(rev=Sum(ex_tax))
    revenue, refunded = o["rev"] or ZERO, back["rev"] or ZERO
    # Sprint 5 P7: unused items of refunded orders put back in stock, at the cost they left at
    returned = q_money(
        StockMovement.objects.filter(
            organization=org, movement_type="refund_return", occurred_at__gte=lo, occurred_at__lt=hi
        ).aggregate(v=Sum(_VALUE))["v"]
        or 0
    )
    net_sales, cogs = revenue - refunded, (o["cost"] or ZERO) - returned
    adj = StockMovement.objects.filter(
        organization=org, movement_type="adjustment", occurred_at__gte=lo, occurred_at__lt=hi
    )
    out, came_in = adj.filter(qty_delta__lt=0), adj.filter(qty_delta__gt=0)
    losses = q_money(-(out.filter(unit_cost__isnull=False).aggregate(v=Sum(_VALUE))["v"] or 0))
    added = q_money(came_in.filter(unit_cost__isnull=False).aggregate(v=Sum(_VALUE))["v"] or 0)
    exp = Expense.objects.filter(organization=org, status="posted", paid_at__gte=lo, paid_at__lt=hi)
    by_cat = {
        r["category"]: r["t"]
        for r in exp.filter(type="general").values("category").annotate(t=Sum("amount"))
    }
    general = sum(by_cat.values(), ZERO)
    # stock bought in the period (posted, paid now or on credit): information only
    purchases = (
        Purchase.objects.filter(
            organization=org, status="posted", posted_at__gte=lo, posted_at__lt=hi
        ).aggregate(t=Sum("total"))["t"]
        or ZERO
    )
    # Sprint 5 Q-C: the bank's fee on card sales, saved on each payment (kept on a refund)
    fees = Payment.objects.filter(order__in=orders).aggregate(t=Sum("fee_amount"))["t"] or ZERO
    unvalued = out.filter(unit_cost__isnull=True)
    gross = None if missing["n"] else net_sales - cogs
    net = None if gross is None or unvalued.exists() else gross - losses - general - fees

    def share(v):  # out of every 100 of net sales
        return S(q_money(v * 100 / net_sales)) if net is not None and net_sales > 0 else None

    discounts = _discounts_ex_tax(orders)
    return {
        "sales_before_discounts": S(revenue + discounts),
        "promotion_discounts": S(discounts),
        "sales": S(revenue),
        "refunds": S(refunded),
        "net_sales": S(net_sales),
        "cost_of_sales": None if gross is None else S(cogs),
        "returned_to_stock": S(returned),
        "gross_profit": None if gross is None else S(gross),
        "gross_margin_pct": (
            # only over positive sales: a refunds-only day would give -65 / -65 = 100 %
            S(q_money(gross * 100 / net_sales)) if gross is not None and net_sales > 0 else None
        ),
        "stock_losses": S(losses),
        "general_expenses": S(general),
        "card_fees": S(fees),
        "expenses_by_category": [
            {"category": c, "amount": S(by_cat[c])}
            for c in sorted(by_cat, key=lambda c: -by_cat[c])
        ],
        "net_profit": None if net is None else S(net),
        "per_100": None
        if share(cogs) is None
        else {
            "cost": share(cogs),
            "losses": share(losses),
            "expenses": share(general + fees),
            "profit": share(net),
        },
        "purchases_info": S(purchases),
        "stock_added_info": S(added),
        "orders_without_cost": missing["n"],
        "sales_without_cost": S(missing["rev"]),
        "estimated_orders": orders.filter(cost_estimated=True).count(),
        "adjustments_without_cost": unvalued.count(),
        "ingredients_without_cost": _ingredients_without_cost(
            org,
            {
                r["ingredient_id"]
                for snap in OrderItem.objects.filter(
                    order__in=orders.filter(cost_total__isnull=True)
                ).values_list("consumption_snapshot", flat=True)
                for r in snap
                if r.get("unit_cost") is None
            }
            | {str(i) for i in unvalued.values_list("ingredient_id", flat=True)},
        ),
    }


def _discounts_ex_tax(orders) -> Decimal:
    """Promotion discounts of these orders without tax, so that sales_before_discounts - discounts
    = sales (total - tax) in both tax modes: with prices that include tax, the discount carries
    its share of tax (rate / (100 + rate)); with tax on top the discount is already before tax."""
    total = ZERO
    for disc, tax in orders.filter(discount_total__gt=0).values_list(
        "discount_total", "tax_snapshot"
    ):
        if tax.get("enabled") and tax.get("inclusive"):
            rate = Decimal(tax["rate"])
            disc = q_money(disc * 100 / (100 + rate))
        total += disc
    return total


def promotions(org, lo, hi, p) -> dict:
    """What each promotion took off in the period (orders dated by their `created_at`, any status:
    the discount was given). Rows come from OrderPromotion, so renames and later edits never
    change them. No per-promotion profit: one order can carry several promotions."""
    rows = (
        OrderPromotion.objects.filter(order__in=_orders(org, lo, hi, p))
        .values("promotion_id")
        .annotate(
            name=Max("name_snapshot"),
            kind=Max("kind"),
            orders_count=Count("order_id", distinct=True),
            manual_count=Count("id", filter=Q(manual=True)),
            discount=Sum("amount"),
        )
        .order_by("-discount", "name")
    )
    out = [
        {
            "promotion_id": str(r["promotion_id"]),
            "name": r["name"],
            "kind": r["kind"],
            "orders_count": r["orders_count"],
            "manual_count": r["manual_count"],
            "discount_total": S(r["discount"]),
        }
        for r in rows
    ]
    return {
        "orders_count": _orders(org, lo, hi, p).count(),
        "orders_with_promotion": OrderPromotion.objects.filter(order__in=_orders(org, lo, hi, p))
        .values("order_id")
        .distinct()
        .count(),
        "discount_total": S(sum((Decimal(r["discount_total"]) for r in out), ZERO)),
        "promotions": out,
    }


def _ingredients_without_cost(org, ids) -> list[str]:
    """Names of the given ingredients that still have no cost today (what the owner must price)."""
    rows = StockBalance.objects.filter(organization=org, ingredient_id__in=ids).select_related(
        "ingredient"
    )
    return sorted({b.ingredient.name for b in rows if unit_cost(b) is None})


REPORTS = {
    "sales-summary": sales_summary,
    "payment-breakdown": payment_breakdown,
    "top-products": top_products,
    "stock": stock,
    "purchases-expenses": purchases_expenses,
    "shifts": shifts,
    "money-in-out": money_in_out,
    "profit": profit,
    "promotions": promotions,
}
