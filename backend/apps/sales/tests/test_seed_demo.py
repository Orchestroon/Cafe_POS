import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.catalog.models import RecipeLine
from apps.inventory.models import StockMovement
from apps.modifiers.models import ModifierGroup, ModifierOption
from conftest import client_for, data

pytestmark = pytest.mark.django_db


@override_settings(DEBUG=True)
def test_seed_demo_is_idempotent_and_sellable(db):
    call_command("seed_demo")
    counts = (
        RecipeLine.objects.count(),
        ModifierGroup.objects.count(),
        ModifierOption.objects.count(),
        StockMovement.objects.count(),
    )
    call_command("seed_demo")
    assert counts == (
        RecipeLine.objects.count(),
        ModifierGroup.objects.count(),
        ModifierOption.objects.count(),
        StockMovement.objects.count(),
    )
    assert counts == (12, 2, 3, 6)

    from apps.accounts.models import User
    from apps.catalog.models import ProductVariant

    c = client_for(User.objects.get(username="barista1"))
    large = ProductVariant.objects.get(label="Large")
    oat = ModifierOption.objects.get(label="Oat Milk")
    shot = ModifierOption.objects.get(label="Extra Shot")
    q = data(
        c.post(
            "/api/v1/orders/quote",
            {
                "items": [
                    {
                        "variant_id": str(large.id),
                        "quantity": 1,
                        "modifier_option_ids": [str(oat.id), str(shot.id)],
                    }
                ]
            },
            format="json",
        )
    )
    assert q["total"] == "120.00" and q["stock_warnings"] == []
    need = {r["name"]: r["required"] for r in q["consumption"]}
    assert "Whole Milk" not in need and need["Oat Milk"] == "250.000"
