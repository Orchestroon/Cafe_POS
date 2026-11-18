"""Return to stock after a refund (Sprint 5 P7, owner 2026-11-17). A refund never returns stock
by itself (D8: the drink was made); for an item that was not used the Admin puts it back here.
Each ingredient comes back at the cost it left at (the order's consumption snapshot), so the
cost of what was sold goes down by exactly that value. Lock order: order row -> balances."""

from decimal import Decimal

from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_avg, q_money, q_qty
from apps.inventory.models import StockMovement
from apps.inventory.services import average_after_purchase, cost_missing, lock_balances, unit_cost

from .models import Order, StockReturn


def returnable(order) -> dict:
    """{ingredient_id: {name, unit, qty, unit_cost}}: what the order consumed, per ingredient."""
    out: dict = {}
    for item in order.items.all():
        for r in item.consumption_snapshot:
            row = out.setdefault(
                r["ingredient_id"],
                {
                    "name": r.get("ingredient_name", ""),
                    "unit": r.get("unit", ""),
                    "qty": Decimal("0"),
                    "unit_cost": r.get("unit_cost"),
                },
            )
            row["qty"] += Decimal(r["total_qty"])
    return out


def _refuse(message, why, status=422):
    return ApiError("STOCK_RETURN_NOT_ALLOWED", message, status, {"why": why})


@transaction.atomic
def return_stock(actor, pk, data) -> StockReturn:
    org = actor.organization
    order = Order.objects.select_for_update().filter(organization=org, pk=pk).first()
    if order is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if order.status != Order.Status.REFUNDED:
        raise _refuse("Only a refunded order can return stock.", "not_refunded")
    if StockReturn.objects.filter(order=order).exists():
        raise _refuse("Stock was already returned for this order.", "already_returned", 409)
    allowed = returnable(order)
    for line in data["lines"]:
        got = allowed.get(str(line["ingredient_id"]))
        if got is None or line["qty"] > got["qty"]:
            raise ApiError(
                "VALIDATION_ERROR",
                "Validation failed.",
                400,
                {"fields": {"lines": "Return at most what this order used, per ingredient."}},
            )
    balances = lock_balances(org, sorted(line["ingredient_id"] for line in data["lines"]))
    ret = StockReturn.objects.create(
        organization=org, order=order, reason=data["reason"], total_value=0, created_by=actor
    )
    value, done = Decimal("0"), []
    for line in sorted(data["lines"], key=lambda x: x["ingredient_id"]):
        bal = balances[line["ingredient_id"]]
        snap = allowed[str(line["ingredient_id"])]["unit_cost"]
        cost = q_avg(Decimal(snap)) if snap is not None else unit_cost(bal)  # old orders: today's
        if cost is None:
            raise cost_missing([bal.ingredient.name])
        qty = q_qty(line["qty"])
        bal.avg_cost = average_after_purchase(bal, qty, cost)
        bal.qty = q_qty(bal.qty + qty)
        bal.save(update_fields=["qty", "avg_cost", "updated_at"])
        StockMovement.objects.create(
            organization=org,
            ingredient_id=bal.ingredient_id,
            location=bal.location,
            qty_delta=qty,
            movement_type=StockMovement.Type.REFUND_RETURN,
            source_type=StockMovement.Source.STOCK_RETURN,
            source_id=ret.id,
            balance_after=bal.qty,
            unit_cost=cost,
            created_by=actor,
        )
        value += qty * cost
        done.append({"ingredient_id": str(bal.ingredient_id), "qty": str(qty)})
    ret.total_value = q_money(value)
    ret.save(update_fields=["total_value", "updated_at"])
    record(
        actor,
        "order.stock_returned",
        order,
        {
            "invoice_no": order.invoice_no,
            "reason": ret.reason,
            "total_value": str(ret.total_value),
            "lines": done,
        },
    )
    return ret
