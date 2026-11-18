"""Atomic checkout (spec 8.4). `place_order` runs inside the idempotency wrapper's transaction.

Lock order, always the same so concurrent checkouts cannot deadlock:
shift row -> invoice counter -> stock balances (by ingredient id)."""

import uuid
from decimal import Decimal

from django.db import IntegrityError, transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_money, q_qty
from apps.inventory.models import StockBalance, StockMovement
from apps.inventory.services import unit_cost
from apps.shifts.models import CashierShift
from apps.tenancy.models import OrganizationSettings
from apps.tenancy.seed import default_location

from . import consumption, loader
from .models import InvoiceCounter, Order, OrderItem, Payment
from .services import price_and_consume, quote_payload, to_requests

ZERO = Decimal("0.00")


def _invalid_payment(message, **details):
    return ApiError("INVALID_PAYMENT", message, 422, details)


def validate_payments(payments, total) -> list[dict]:
    """Spec 8.4 step 5. Returns normalized rows with cash tendered and change filled in.
    A 0.00 order takes no payment at all (owner decision, 2026-11-10)."""
    if total == ZERO:
        if payments:
            raise _invalid_payment("A 0.00 order takes no payment.")
        return []
    if not 1 <= len(payments) <= 2:
        raise _invalid_payment("Send one or two payments.")
    methods = [p["method"] for p in payments]
    if len(set(methods)) != len(methods):
        raise _invalid_payment("Only one payment per method.")
    rows = []
    for p in payments:
        amount = q_money(p["amount"])
        if amount <= 0:
            raise _invalid_payment("Payment amounts must be greater than zero.", method=p["method"])
        row = {
            "method": p["method"],
            "amount": amount,
            "cash_tendered": None,
            "change_given": None,
            "external_reference": (p.get("external_reference") or "").strip(),
        }
        if p["method"] == "cash":
            tendered = q_money(p["cash_tendered"]) if p.get("cash_tendered") is not None else amount
            if tendered < amount:
                raise _invalid_payment("Cash tendered is less than the cash amount.")
            row["cash_tendered"], row["change_given"] = tendered, q_money(tendered - amount)
        elif p.get("cash_tendered") is not None:
            raise _invalid_payment("cash_tendered applies to cash payments only.")
        rows.append(row)
    paid = q_money(sum((r["amount"] for r in rows), ZERO))
    if paid != total:
        raise ApiError(
            "PAYMENT_MISMATCH",
            "Payments must add up to the order total.",
            422,
            {"total": str(total), "paid": str(paid)},
        )
    return rows


def _lock_shift(user) -> CashierShift:
    shift = (
        CashierShift.objects.select_for_update()
        .filter(user=user, status=CashierShift.Status.OPEN)
        .first()
    )
    if shift is None:
        raise ApiError("SHIFT_NOT_OPEN", "Open your shift before selling.", 409)
    return shift


def _next_invoice(org):
    try:
        counter = InvoiceCounter.objects.select_for_update().get(organization=org)
    except InvoiceCounter.DoesNotExist:
        try:
            with transaction.atomic():
                InvoiceCounter.objects.create(organization=org)
        except IntegrityError:
            pass
        counter = InvoiceCounter.objects.select_for_update().get(organization=org)
    counter.last_number += 1
    counter.save(update_fields=["last_number", "updated_at"])
    prefix = OrganizationSettings.objects.get(organization=org).invoice_prefix
    return counter.last_number, f"{prefix}{counter.last_number:07d}"


def _recipe_snapshot(lines):
    return [
        {
            "ingredient_id": str(w.ingredient_id),
            "ingredient_name": w.ingredient_name,
            "unit": w.unit,
            "base_qty": str(w.base_qty),
            "waste_pct": str(w.waste_pct),
            "slot_key": w.slot_key,
            "source": w.source,
            **({"option_id": str(w.option_id)} if w.option_id else {}),
        }
        for w in lines
    ]


def _lock_stock(org, consumptions):
    """Lock every balance the order touches, in id order (after the invoice counter, as always).
    Returns {ingredient_id (UUID): StockBalance}."""
    ids = {_uuid(row["ingredient_id"]) for c in consumptions for row in c.per_ingredient}
    balances = loader.locked_balances(org, ids)
    for missing in ids - set(balances):  # an ingredient always has a balance row; be safe anyway
        balances[missing] = StockBalance.objects.create(
            organization=org, ingredient_id=missing, location=default_location(org)
        )
    return balances


def _costed(cons, balances):
    """Consumption rows with the cost per unit at sale time, and the item's cost (None when any
    ingredient has no known cost: never counted as 0). Owner, 2026-11-16: weighted average."""
    rows, total = [], Decimal("0")
    for row in cons.per_ingredient:
        uc = unit_cost(balances[_uuid(row["ingredient_id"])])
        cost = None if uc is None else Decimal(row["total_qty"]) * uc
        if total is not None:
            total = None if cost is None else total + cost
        rows.append(
            {
                **row,
                "unit_cost": None if uc is None else str(uc),
                "cost": None if cost is None else str(q_money(cost)),
            }
        )
    return rows, None if total is None else q_money(total)


def _deduct_stock(user, org, order_items, balances, required):
    """Step 10: apply the negative deltas to the locked balances and write the ledger rows.
    Returns the stock warnings computed from the locked (true) balances."""
    available = {str(i): b.qty for i, b in balances.items()}
    for item, cons in order_items:
        for row in cons.per_ingredient:
            bal = balances[_uuid(row["ingredient_id"])]
            qty = q_qty(row["total_qty"])
            bal.qty = q_qty(bal.qty - qty)
            StockMovement.objects.create(
                organization=org,
                ingredient_id=bal.ingredient_id,
                location=bal.location,
                qty_delta=-qty,
                movement_type=StockMovement.Type.SALE,
                source_type=StockMovement.Source.ORDER_ITEM,
                source_id=item.pk,
                balance_after=bal.qty,
                unit_cost=unit_cost(bal),
                created_by=user,
            )
    for bal in balances.values():
        bal.save(update_fields=["qty", "updated_at"])
    return consumption.stock_warnings(required, available)


def _uuid(value):
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def place_order(user, data, key) -> tuple[int, dict]:
    org = user.organization
    shift = _lock_shift(user)  # 1. own open shift (row locked until commit)
    requests = to_requests(data["items"])  # 2. non-empty cart
    priced, consumptions, required = price_and_consume(org, requests)  # 3. fresh DB data
    expected = q_money(data["expected_total"])  # 4. the client's total must match the server's
    if expected != priced.total:
        available = loader.read_balances(org, list(required))
        warnings = consumption.stock_warnings(required, available)
        raise ApiError(
            "PRICE_CHANGED",
            "The price changed. Review the new total.",
            409,
            {"server_total": str(priced.total), "quote": quote_payload(priced, required, warnings)},
        )
    pay_rows = validate_payments(data["payments"], priced.total)  # 5.
    fee_pct = OrganizationSettings.objects.get(organization=org).card_fee_pct
    for row in pay_rows:  # Sprint 5 Q-C: the card fee is a cost of the sale, saved with it
        row["fee_amount"] = q_money(row["amount"] * fee_pct / 100) if row["method"] == "card" else 0

    seq, invoice_no = _next_invoice(org)  # 6. gapless: rolls back with a failed checkout
    balances = _lock_stock(org, consumptions)  # 6b. stock locks, and the costs at this moment
    costed = [_costed(c, balances) for c in consumptions]
    item_costs = [c for _, c in costed]
    order_cost = None if None in item_costs else q_money(sum(item_costs, Decimal("0")))
    order = Order.objects.create(  # 7.
        organization=org,
        branch=shift.branch,
        shift=shift,
        cashier=user,
        invoice_seq=seq,
        invoice_no=invoice_no,
        status=Order.Status.PAID,
        subtotal=priced.subtotal,
        discount_total=priced.discount_total,
        tax_total=priced.tax_total,
        total=priced.total,
        tax_snapshot=priced.tax.snapshot(),
        cost_total=order_cost,
        note=(data.get("note") or "").strip(),
        idempotency_key=key,
    )
    order_items = []
    for p, cons, (cost_rows, item_cost) in zip(  # 8. items with snapshots
        priced.items, consumptions, costed, strict=True
    ):
        item = OrderItem.objects.create(
            organization=org,
            order=order,
            variant_id=p.variant.id,
            quantity=p.request.quantity,
            product_name_snapshot=p.variant.product_name,
            variant_label_snapshot=p.variant.label,
            unit_price=p.unit_price,
            unit_discount=p.unit_discount,
            line_subtotal=p.line_subtotal,
            line_discount=p.line_discount,
            line_total=p.line_total,
            cost_total=item_cost,
            modifiers_snapshot=list(p.modifiers),
            recipe_snapshot=_recipe_snapshot(cons.lines),
            consumption_snapshot=cost_rows,
            promotion_snapshot=None,
        )
        order_items.append((item, cons))
    payments = [  # 9.
        Payment.objects.create(organization=org, order=order, shift=shift, **row)
        for row in pay_rows
    ]
    warnings = _deduct_stock(user, org, order_items, balances, required)  # 10.
    record(  # 11.
        user,
        "order.created",
        order,
        {
            "invoice_no": invoice_no,
            "total": str(order.total),
            "items": len(order_items),
            "payments": [{"method": p.method, "amount": str(p.amount)} for p in payments],
            "shift_id": str(shift.pk),
        },
    )
    cash = next((p for p in payments if p.method == Payment.Method.CASH), None)
    body = {  # 12.
        "order_id": str(order.pk),
        "invoice_no": invoice_no,
        "status": order.status,
        "subtotal": str(order.subtotal),
        "discount_total": str(order.discount_total),
        "tax_total": str(order.tax_total),
        "total": str(order.total),
        "payments": [
            {
                "method": p.method,
                "amount": str(p.amount),
                **(
                    {"cash_tendered": str(p.cash_tendered), "change_given": str(p.change_given)}
                    if p.method == Payment.Method.CASH
                    else {"external_reference": p.external_reference}
                ),
            }
            for p in payments
        ],
        "change_due": str(cash.change_given) if cash else str(ZERO),
        "receipt_url": f"/api/v1/orders/{order.pk}/receipt",
        "stock_warnings": warnings,
    }
    return 201, body
