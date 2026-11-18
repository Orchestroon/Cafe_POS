"""Sprint 5 (L1/L3, owner 2026-11-17): the hand-typed reference cost is removed. Where an
ingredient has stock on hand, no average cost yet and a typed cost, that typed cost becomes its
average, so stock already in the café keeps the cost it was being sold at. Ledger rows are not
touched. Then the column is dropped."""

from django.db import migrations, models


def keep_typed_cost_for_stock_on_hand(apps, schema_editor):
    StockBalance = apps.get_model("inventory", "StockBalance")
    for bal in StockBalance.objects.filter(
        avg_cost__isnull=True, qty__gt=0, ingredient__reference_unit_cost__isnull=False
    ).select_related("ingredient"):
        bal.avg_cost = bal.ingredient.reference_unit_cost
        bal.save(update_fields=["avg_cost"])


class Migration(migrations.Migration):
    dependencies = [("inventory", "0003_backfill_avg_cost")]

    operations = [
        migrations.RunPython(keep_typed_cost_for_stock_on_hand, migrations.RunPython.noop),
        migrations.RemoveField(model_name="ingredient", name="reference_unit_cost"),
        migrations.AddField(
            model_name="stockadjustment",
            name="total_value",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
    ]
