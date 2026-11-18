from django.db import migrations

from apps.inventory.backfill import backfill_average_cost


class Migration(migrations.Migration):
    dependencies = [
        ("inventory", "0002_money_review"),
        ("purchasing", "0002_money_review"),
    ]

    operations = [migrations.RunPython(backfill_average_cost, migrations.RunPython.noop)]
