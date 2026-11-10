"""Dict builders for order list/detail/receipt. They read the order's own snapshots, so later
changes to products, prices, recipes or tax settings never change an old order or receipt."""

from apps.tenancy.models import OrganizationSettings

from .models import Refund


def _ts(dt):
    return dt.isoformat().replace("+00:00", "Z")


def _cashier(order):
    u = order.cashier
    return {"id": str(u.pk), "display_name": u.display_name or u.username}


def payment_dict(p):
    out = {"method": p.method, "amount": str(p.amount)}
    if p.method == "cash":
        out["cash_tendered"] = str(p.cash_tendered)
        out["change_given"] = str(p.change_given)
    else:
        out["external_reference"] = p.external_reference
    return out


def refund_dict(order):
    """The order's refund (or None). Needs `refund__actor` / `refund__lines` prefetched."""
    try:
        r = order.refund
    except Refund.DoesNotExist:
        return None
    return {
        "id": str(r.pk),
        "created_at": _ts(r.created_at),
        "actor": {"id": str(r.actor_id), "display_name": r.actor.display_name or r.actor.username},
        "reason": r.reason,
        "total_amount": str(r.total_amount),
        "shift_id": str(r.shift_id) if r.shift_id else None,
        "lines": [
            {
                "method": ln.method,
                "amount": str(ln.amount),
                "external_reference": ln.external_reference,
            }
            for ln in r.lines.all()
        ],
        "inventory_restored": False,
    }


def order_summary(order):
    return {
        "id": str(order.pk),
        "invoice_no": order.invoice_no,
        "status": order.status,
        "total": str(order.total),
        "created_at": _ts(order.created_at),
        "cashier": _cashier(order),
        "items_count": sum(i.quantity for i in order.items.all()),
        "payment_methods": sorted(p.method for p in order.payments.all()),
    }


def order_detail(order, *, admin):
    items = []
    for i in order.items.all():
        row = {
            "id": str(i.pk),
            "product_name": i.product_name_snapshot,
            "variant_label": i.variant_label_snapshot,
            "quantity": i.quantity,
            "unit_price": str(i.unit_price),
            "unit_discount": str(i.unit_discount),
            "line_subtotal": str(i.line_subtotal),
            "line_discount": str(i.line_discount),
            "line_total": str(i.line_total),
            "modifiers": i.modifiers_snapshot,
        }
        if admin:  # recipes and consumption are business internals
            row["recipe"] = i.recipe_snapshot
            row["consumption"] = i.consumption_snapshot
        items.append(row)
    return {
        **order_summary(order),
        "shift_id": str(order.shift_id),
        "subtotal": str(order.subtotal),
        "discount_total": str(order.discount_total),
        "tax_total": str(order.tax_total),
        "tax": order.tax_snapshot,
        "note": order.note,
        "items": items,
        "payments": [payment_dict(p) for p in order.payments.all()],
        "refund": refund_dict(order),
    }


def receipt(order):
    s = OrganizationSettings.objects.get(organization=order.organization)
    tax = order.tax_snapshot
    return {
        "business": {
            "name": s.business_name,
            "header": s.receipt_header,
            "footer": s.receipt_footer,
            "tax_registration_number": s.tax_registration_number,
        },
        "invoice_no": order.invoice_no,
        "status": order.status,
        "created_at": _ts(order.created_at),
        "timezone": s.timezone,
        "cashier": _cashier(order)["display_name"],
        "items": [
            {
                "name": i.product_name_snapshot,
                "variant": i.variant_label_snapshot,
                "quantity": i.quantity,
                "modifiers": [m["option_label"] for m in i.modifiers_snapshot],
                "unit_price": str(i.unit_price),
                "line_total": str(i.line_total),
            }
            for i in order.items.all()
        ],
        "subtotal": str(order.subtotal),
        "discount_total": str(order.discount_total),
        "tax": {
            "enabled": tax["enabled"],
            "label": tax["label"],
            "rate": tax["rate"],
            "inclusive": tax["inclusive"],
            "amount": str(order.tax_total),
        },
        "total": str(order.total),
        "payments": [payment_dict(p) for p in order.payments.all()],
        "refund": refund_dict(order),
        "paper_width": s.receipt_paper_width,
        "currency": s.currency,
    }


def refund_row(r):
    """One refunds-ledger row."""
    return {
        "id": str(r.pk),
        "created_at": _ts(r.created_at),
        "order_id": str(r.order_id),
        "invoice_no": r.order.invoice_no,
        "original_cashier": _cashier(r.order),
        "actor": {"id": str(r.actor_id), "display_name": r.actor.display_name or r.actor.username},
        "reason": r.reason,
        "total_amount": str(r.total_amount),
        "shift_id": str(r.shift_id) if r.shift_id else None,
        "lines": [
            {
                "method": ln.method,
                "amount": str(ln.amount),
                "external_reference": ln.external_reference,
            }
            for ln in r.lines.all()
        ],
    }


def payment_row(p):
    """One payments-ledger row."""
    return {
        **payment_dict(p),
        "id": str(p.pk),
        "created_at": _ts(p.created_at),
        "order_id": str(p.order_id),
        "invoice_no": p.order.invoice_no,
        "order_status": p.order.status,
        "cashier": _cashier(p.order),
        "shift_id": str(p.shift_id),
    }
