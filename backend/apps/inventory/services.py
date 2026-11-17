from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import ApiError
from apps.core.money import q_avg, q_qty
from apps.tenancy.seed import default_location

from .models import StockAdjustment, StockBalance, StockMovement


@transaction.atomic
def create_ingredient(actor, serializer):
    ing = serializer.save(organization=actor.organization)
    StockBalance.objects.create(
        organization=actor.organization,
        ingredient=ing,
        location=default_location(actor.organization),
    )
    record(
        actor,
        "ingredient.created",
        ing,
        {
            "name": ing.name,
            "base_unit": ing.base_unit,
            "low_stock_threshold": str(ing.low_stock_threshold),
        },
    )
    return ing


def _used_by(ing) -> list[str]:
    """Product sizes and modifier options whose stock effect uses this ingredient."""
    from apps.catalog.models import RecipeLine
    from apps.modifiers.models import ModifierEffect

    sizes = RecipeLine.objects.filter(ingredient=ing).values_list(
        "variant__product__name", "variant__label"
    )
    options = ModifierEffect.objects.filter(ingredient=ing).values_list(
        "option__group__name", "option__label"
    )
    return sorted({f"{a} ({b})" for a, b in sizes} | {f"{a}: {b}" for a, b in options})


@transaction.atomic
def update_ingredient(actor, serializer):
    ing = type(serializer.instance).objects.select_for_update().get(pk=serializer.instance.pk)
    serializer.instance = ing
    if ing.is_active and serializer.validated_data.get("is_active") is False:
        # A sale would keep deducting an ingredient nobody sees any more (money review, 2026-11-16).
        used = _used_by(ing)
        if used:
            raise ApiError(
                "INGREDIENT_IN_USE",
                "This ingredient is used by recipes or options. Remove it from them first.",
                409,
                {"used_by": used},
            )
    changes = {}
    for k, v in serializer.validated_data.items():
        if str(getattr(ing, k)) != str(v):
            changes[k] = {"before": str(getattr(ing, k)), "after": str(v)}
    ing = serializer.save()
    if changes:
        record(actor, "ingredient.updated", ing, {"changes": changes})
    return ing


def unit_cost(bal):
    """Cost per base unit used for a movement now: the weighted average, else the ingredient's
    reference cost, else None (unknown, never treated as 0)."""
    if bal.avg_cost is not None:
        return bal.avg_cost
    return bal.ingredient.reference_unit_cost


def average_after_purchase(bal, qty, cost):
    """Weighted average after receiving `qty` at `cost` per unit (owner, 2026-11-16).
    With no stock on hand (zero or negative) or no known cost, the purchase price is the cost."""
    current = unit_cost(bal)
    if current is None or bal.qty <= 0:
        return q_avg(cost)
    return q_avg((bal.qty * current + qty * cost) / (bal.qty + qty))


def average_after_void(bal, qty, cost):
    """Take a voided purchase back out of the average: (on_hand x avg - qty x cost) / (on_hand -
    qty). When nothing would be left, or the result would be negative because the stock was
    already used, the average stays as it is."""
    current = unit_cost(bal)
    left = bal.qty - qty
    if current is None or left <= 0:
        return bal.avg_cost
    value = bal.qty * current - qty * cost
    return q_avg(value / left) if value >= 0 else bal.avg_cost


def _lock_balances(org, ingredient_ids):
    """Lock in ingredient_id order (deadlock-safe) and return {ingredient_id: balance}. The
    ingredient is joined (not locked) for its reference cost."""
    location = default_location(org)
    rows = (
        StockBalance.objects.select_for_update(of=("self",))
        .select_related("ingredient")
        .filter(organization=org, location=location, ingredient_id__in=ingredient_ids)
        .order_by("ingredient_id")
    )
    return {b.ingredient_id: b for b in rows}


def lock_balances(org, ingredient_ids):
    """Public wrapper: lock balances in ingredient_id order (deadlock-safe)."""
    return _lock_balances(org, ingredient_ids)


def _get_ingredient_balance(org, ingredient_id):
    bal = _lock_balances(org, [ingredient_id]).get(ingredient_id)
    if bal is None:
        raise ApiError("NOT_FOUND", "Ingredient not found.", 404)
    return bal


def _post_movement(actor, bal, adjustment, movement_type, delta):
    bal.qty = q_qty(bal.qty + delta)
    bal.save(update_fields=["qty", "updated_at"])
    return StockMovement.objects.create(
        organization=bal.organization,
        ingredient_id=bal.ingredient_id,
        location=bal.location,
        qty_delta=delta,
        movement_type=movement_type,
        source_type=StockMovement.Source.STOCK_ADJUSTMENT,
        source_id=adjustment.id,
        balance_after=bal.qty,
        unit_cost=unit_cost(bal),
        created_by=actor,
    )


@transaction.atomic
def adjust_stock(actor, *, ingredient_id, mode, reason, qty_delta=None, counted_qty=None):
    bal = _get_ingredient_balance(actor.organization, ingredient_id)  # row lock held to commit
    if mode == "delta":
        delta, kind, counted = q_qty(qty_delta), StockAdjustment.Kind.ADJUSTMENT, None
    else:
        counted = q_qty(counted_qty)
        delta, kind = q_qty(counted - bal.qty), StockAdjustment.Kind.COUNT
    before = bal.qty
    adj = StockAdjustment.objects.create(
        organization=actor.organization,
        ingredient_id=ingredient_id,
        location=bal.location,
        kind=kind,
        qty_delta=delta,
        counted_qty=counted,
        reason=reason,
        created_by=actor,
    )
    movement = (
        _post_movement(actor, bal, adj, StockMovement.Type.ADJUSTMENT, delta) if delta else None
    )
    record(
        actor,
        "stock.counted" if kind == StockAdjustment.Kind.COUNT else "stock.adjusted",
        adj,
        {
            "ingredient_id": str(ingredient_id),
            "reason": reason,
            "qty_delta": str(delta),
            "counted_qty": None if counted is None else str(counted),
            "balance_before": str(before),
            "balance_after": str(bal.qty),
        },
    )
    return adj, movement, bal


@transaction.atomic
def set_opening_balances(actor, items):
    org = actor.organization
    ids = [i["ingredient_id"] for i in items]
    if len(set(ids)) != len(ids):
        raise ApiError("VALIDATION_ERROR", "Duplicate ingredient.", 400)
    balances = _lock_balances(org, sorted(ids))
    unknown = [str(i) for i in ids if i not in balances]
    if unknown:
        raise ApiError(
            "VALIDATION_ERROR", "Unknown ingredient.", 400, {"fields": {"ingredient_id": unknown}}
        )
    if StockMovement.objects.filter(organization=org, ingredient_id__in=ids).exists():
        raise ApiError("OPENING_BALANCE_EXISTS", "An ingredient already has stock movements.", 409)
    results = []
    for item in sorted(items, key=lambda i: i["ingredient_id"]):
        bal = balances[item["ingredient_id"]]
        qty = q_qty(item["qty"])
        adj = StockAdjustment.objects.create(
            organization=org,
            ingredient_id=bal.ingredient_id,
            location=bal.location,
            kind=StockAdjustment.Kind.OPENING,
            qty_delta=qty,
            reason="Opening balance",
            created_by=actor,
        )
        _post_movement(actor, bal, adj, StockMovement.Type.OPENING, qty)
        record(
            actor,
            "stock.opening_balance",
            adj,
            {"ingredient_id": str(bal.ingredient_id), "qty": str(qty)},
        )
        results.append(bal)
    return results
