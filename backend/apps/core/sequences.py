"""Auto-generated codes (Step 1, D22): SKU-00001 for product sizes, PUR-00001 for purchases.
The counter row is locked, so two requests never get the same number, and it rolls back with the
caller's transaction. Separate from `sales.InvoiceCounter` (spec 8.11) so a purchase or a catalog
save never waits behind a checkout."""

from django.db import transaction

from .models import Sequence


@transaction.atomic
def next_number(organization_id, name: str) -> int:
    Sequence.objects.get_or_create(organization_id=organization_id, name=name)
    seq = Sequence.objects.select_for_update().get(organization_id=organization_id, name=name)
    seq.last_number += 1
    seq.save(update_fields=["last_number", "updated_at"])
    return seq.last_number
