"""One-time fill of the average cost from purchases posted before the cost update (owner,
2026-11-17: Coffee Beans and Water were bought on 10 Nov but had no average cost, so sales after
the update had no cost). Replays each balance's movements in time order with the same rules as a
live post/void. Balances that already have an average (purchases after the update) are left as
they are. The stock ledger is not changed (append-only)."""

from types import SimpleNamespace

from apps.core.money import q_avg


def backfill_average_cost(apps, schema_editor):
    from apps.inventory.services import average_after_purchase, average_after_void

    StockBalance = apps.get_model("inventory", "StockBalance")
    StockMovement = apps.get_model("inventory", "StockMovement")
    PurchaseItem = apps.get_model("purchasing", "PurchaseItem")
    kinds = ("purchase", "purchase_void")
    for bal in StockBalance.objects.filter(avg_cost__isnull=True).select_related("ingredient"):
        moves = StockMovement.objects.filter(
            ingredient_id=bal.ingredient_id, location_id=bal.location_id
        ).order_by("occurred_at", "created_at")
        if not moves.filter(movement_type__in=kinds).exists():
            continue
        items = {
            i.pk: i
            for i in PurchaseItem.objects.filter(
                pk__in=moves.filter(movement_type__in=kinds).values("source_id")
            )
        }
        state = SimpleNamespace(qty=0, avg_cost=None, ingredient=bal.ingredient)
        for m in moves:
            state.qty = m.balance_after - m.qty_delta  # on hand just before this movement
            item = items.get(m.source_id) if m.movement_type in kinds else None
            if item is not None:
                cost = q_avg(item.line_total / item.qty)  # as purchasing.services.item_cost
                fn = average_after_purchase if m.movement_type == "purchase" else average_after_void
                state.avg_cost = fn(state, item.qty, cost)
        if state.avg_cost is not None:
            bal.avg_cost = state.avg_cost
            bal.save(update_fields=["avg_cost"])
