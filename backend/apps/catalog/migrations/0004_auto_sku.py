"""D22: every size without a SKU gets SKU-0000n (oldest first); the counter resumes after."""

from django.db import migrations
from django.db.models import Q


def give_skus(apps, schema_editor):
    ProductVariant = apps.get_model("catalog", "ProductVariant")
    Sequence = apps.get_model("core", "Sequence")
    taken = set(ProductVariant.objects.exclude(sku__isnull=True).values_list("organization_id", "sku"))
    last = {}
    rows = ProductVariant.objects.filter(Q(sku__isnull=True) | Q(sku="")).order_by("created_at", "id")
    for v in rows:
        n = last.get(v.organization_id, 0)
        while True:  # skip a number a typed SKU already uses
            n += 1
            sku = f"SKU-{n:05d}"
            if (v.organization_id, sku) not in taken:
                break
        last[v.organization_id] = n
        taken.add((v.organization_id, sku))
        ProductVariant.objects.filter(pk=v.pk).update(sku=sku)
    for org_id, n in last.items():
        Sequence.objects.update_or_create(
            organization_id=org_id, name="sku", defaults={"last_number": n}
        )


class Migration(migrations.Migration):
    dependencies = [("catalog", "0003_track_stock"), ("core", "0003_sequence")]
    operations = [migrations.RunPython(give_skus, migrations.RunPython.noop)]
