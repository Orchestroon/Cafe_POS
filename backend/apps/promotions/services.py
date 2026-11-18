"""Promotion rules: read model, audited create/update, and the status shown to the Admin."""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import transaction

from apps.audit.services import record
from apps.catalog.models import ProductVariant, RecipeLine
from apps.core.money import q_money
from apps.inventory.models import StockBalance
from apps.inventory.services import unit_cost
from apps.tenancy.models import OrganizationSettings

from .models import ComboSlot, Promotion
from .schedule import is_live


def _t(value):
    return value.strftime("%H:%M") if value else None


def promotion_dict(p: Promotion) -> dict:
    """The complete rules, in the shape the API accepts (so a PATCH can be merged with it)."""
    return {
        "name": p.name,
        "kind": p.kind,
        "is_active": p.is_active,
        "auto_apply": p.auto_apply,
        "scope": p.scope,
        "discount_type": p.discount_type,
        "discount_value": None if p.discount_value is None else str(p.discount_value),
        "variant_ids": sorted(str(v.pk) for v in p.variants.all()),
        "category_ids": sorted(str(c.pk) for c in p.categories.all()),
        "combo_price": None if p.combo_price is None else str(p.combo_price),
        "slots": [
            {
                "quantity": s.quantity,
                "category_id": str(s.category_id) if s.category_id else None,
                "variant_ids": sorted(str(v.pk) for v in s.variants.all()),
            }
            for s in p.slots.all()
        ],
        "starts_on": p.starts_on.isoformat() if p.starts_on else None,
        "ends_on": p.ends_on.isoformat() if p.ends_on else None,
        "days_of_week": sorted(p.days_of_week),
        "window_start": _t(p.window_start),
        "window_end": _t(p.window_end),
    }


def status_of(p: Promotion, now_local: datetime) -> str:
    """off / expired / scheduled (starts later) / active (`live_now` says whether it is on now)."""
    today = now_local.date()
    if not p.is_active:
        return "off"
    if p.ends_on and p.ends_on < today:
        return "expired"
    if p.starts_on and p.starts_on > today:
        return "scheduled"
    return "active"


def full_dict(p: Promotion, now_local: datetime) -> dict:
    live = is_live(p.starts_on, p.ends_on, p.days_of_week, p.window_start, p.window_end, now_local)
    return {
        "id": str(p.pk),
        **promotion_dict(p),
        "status": status_of(p, now_local),
        "live_now": p.is_active and live,
        "created_at": p.created_at.isoformat().replace("+00:00", "Z"),
    }


def local_now(org) -> datetime:
    tz = OrganizationSettings.objects.get(organization=org).timezone
    return datetime.now(ZoneInfo(tz))


def queryset(org):
    return Promotion.objects.filter(organization=org).prefetch_related(
        "variants", "categories", "slots__variants"
    )


def _write(p: Promotion, a: dict) -> None:
    p.name, p.kind, p.is_active, p.auto_apply = (
        a["name"],
        a["kind"],
        a["is_active"],
        a["auto_apply"],
    )
    p.scope, p.discount_type, p.discount_value = a["scope"], a["discount_type"], a["discount_value"]
    p.combo_price = a["combo_price"]
    p.starts_on, p.ends_on, p.days_of_week = a["starts_on"], a["ends_on"], a["days_of_week"]
    p.window_start, p.window_end = a["window_start"], a["window_end"]
    p.save()
    p.variants.set(a["variant_ids"])
    p.categories.set(a["category_ids"])
    p.slots.all().delete()  # slots are replaced as a whole; history lives in order snapshots
    for pos, s in enumerate(a["slots"]):
        slot = ComboSlot.objects.create(
            organization=p.organization,
            promotion=p,
            quantity=s["quantity"],
            category_id=s["category_id"],
            position=pos,
        )
        slot.variants.set(s["variant_ids"])


def _names(*dicts) -> dict:
    """{id: readable name} for every size and category the rules name (the audit log is text)."""
    from apps.catalog.models import Category, ProductVariant

    ids = set()
    for d in dicts:
        ids |= set(d["variant_ids"]) | set(d["category_ids"])
        for s in d["slots"]:
            ids |= set(s["variant_ids"]) | ({s["category_id"]} if s["category_id"] else set())
    out = {
        str(v.pk): f"{v.product.name} ({v.label})"
        for v in ProductVariant.objects.filter(pk__in=ids).select_related("product")
    }
    out.update({str(c.pk): c.name for c in Category.objects.filter(pk__in=ids)})
    return out


def _show(key, v, names):
    """Audit values are plain text (the log never shows JSON or ids)."""
    if key in ("variant_ids", "category_ids"):
        return ", ".join(names.get(i, "?") for i in v)
    if key == "slots":
        return " + ".join(
            f"{s['quantity']}× "
            + ", ".join(
                [
                    *([names.get(s["category_id"], "?")] if s["category_id"] else []),
                    *(names.get(i, "?") for i in s["variant_ids"]),
                ]
            )
            for s in v
        )
    if key == "days_of_week":
        return ", ".join(str(d) for d in v)
    return "" if v is None else str(v)


@transaction.atomic
def create_promotion(actor, a: dict) -> Promotion:
    p = Promotion(organization=actor.organization)
    _write(p, a)
    p = queryset(actor.organization).get(pk=p.pk)
    after = promotion_dict(p)
    names = _names(after)
    shown = {k: _show(k, v, names) for k, v in after.items()}
    record(actor, "promotion.created", p, {"after": {k: v for k, v in shown.items() if v}})
    return p


@transaction.atomic
def update_promotion(actor, pk, a: dict) -> Promotion:
    locked = Promotion.objects.select_for_update().get(organization=actor.organization, pk=pk)
    before = promotion_dict(queryset(actor.organization).get(pk=locked.pk))
    _write(locked, a)
    p = queryset(actor.organization).get(pk=pk)
    after = promotion_dict(p)
    names = _names(before, after)
    changes = {
        k: {"before": _show(k, before[k], names), "after": _show(k, after[k], names)}
        for k in after
        if before[k] != after[k]
    }
    if changes:
        record(actor, "promotion.updated", p, {"changes": changes})
    return p


def variant_costs(org) -> list[dict]:
    """One row per active size: its price and what its recipe costs at today's average costs
    (waste included, extras not). Read-only, for the below-cost warning (D8)."""
    avg = {b.ingredient_id: unit_cost(b) for b in StockBalance.objects.filter(organization=org)}
    cost, unknown = {}, set()
    for r in RecipeLine.objects.filter(organization=org):
        uc = avg.get(r.ingredient_id)
        if uc is None:
            unknown.add(r.variant_id)
        else:
            cost[r.variant_id] = (
                cost.get(r.variant_id, 0) + r.base_qty * (1 + r.waste_pct / 100) * uc
            )
    rows = ProductVariant.objects.filter(
        organization=org, is_active=True, product__is_active=True
    ).select_related("product")
    return [
        {
            "variant_id": str(v.pk),
            "product_name": v.product.name,
            "variant_label": v.label,
            "category_id": str(v.product.category_id),
            "price": str(v.price),
            # a size with no recipe has no cost to compare with (None), never 0
            "cost": None if v.pk in unknown or v.pk not in cost else str(q_money(cost[v.pk])),
        }
        for v in rows.order_by("product__name", "sort_order", "price")
    ]
