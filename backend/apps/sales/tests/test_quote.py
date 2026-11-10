from decimal import Decimal

import pytest

from apps.audit.models import AuditEvent
from apps.inventory.models import StockMovement
from apps.sales.models import Order
from apps.tenancy.models import OrganizationSettings
from conftest import data

from .conftest import balance, item

pytestmark = pytest.mark.django_db
Q = "/api/v1/orders/quote"


def quote(c, *items):
    return c.post(Q, {"items": list(items)}, format="json")


def need(q):
    return {r["name"]: r["required"] for r in q["consumption"]}


def test_quote_needs_no_shift_and_writes_nothing(barista_c, shop):
    before = (StockMovement.objects.count(), AuditEvent.objects.count(), Order.objects.count())
    r = quote(barista_c, item(shop.small, 2))
    assert r.status_code == 200
    q = data(r)
    assert q["total"] == "130.00" and q["subtotal"] == "130.00" and q["tax_total"] == "0.00"
    assert q["items"][0]["unit_price"] == "65.00" and q["items"][0]["line_total"] == "130.00"
    assert (
        StockMovement.objects.count(),
        AuditEvent.objects.count(),
        Order.objects.count(),
    ) == before


def test_at02_small_and_large_consume_differently(barista_c, shop):
    small = data(quote(barista_c, item(shop.small)))
    large = data(quote(barista_c, item(shop.large)))
    assert need(small) == {"Coffee Beans": "12.600", "Whole Milk": "200.000", "Cup": "1.000"}
    assert need(large) == {"Coffee Beans": "18.900", "Whole Milk": "300.000", "Cup": "1.000"}


def test_at03_waste_applied_once_exactly_12_600(barista_c, shop):
    assert need(data(quote(barista_c, item(shop.small, 2))))["Coffee Beans"] == "25.200"


def test_at04_oat_replaces_milk(barista_c, shop):
    q = data(quote(barista_c, item(shop.large, 1, [shop.oat])))
    assert q["total"] == "100.00"  # 80 + oat large override 20
    assert need(q) == {"Coffee Beans": "18.900", "Oat Milk": "250.000", "Cup": "1.000"}
    small = data(quote(barista_c, item(shop.small, 1, [shop.oat])))
    assert small["total"] == "80.00" and need(small)["Oat Milk"] == "180.000"


def test_at05_extra_shot_adds_price_and_coffee(barista_c, shop):
    q = data(quote(barista_c, item(shop.small, 1, [shop.shot])))
    assert q["total"] == "85.00"
    assert need(q)["Coffee Beans"] == "21.000"  # 12.6 recipe + 8.4 extra shot
    assert q["items"][0]["modifiers"] == [
        {"option_id": str(shop.shot.id), "label": "Extra Shot", "price_delta": "20.00"}
    ]


def test_large_oat_extra_shot_combined(barista_c, shop):
    q = data(quote(barista_c, item(shop.large, 1, [shop.oat, shop.shot])))
    assert q["total"] == "120.00"
    assert need(q) == {"Coffee Beans": "27.300", "Oat Milk": "250.000", "Cup": "1.000"}


def test_stock_warnings_do_not_block(barista_c, shop):
    r = quote(barista_c, item(shop.large, 5, [shop.oat]))  # 1250 ml oat needed, 1000 in stock
    assert r.status_code == 200
    w = data(r)["stock_warnings"]
    assert w == [
        {
            "ingredient_id": str(shop.ing["Oat Milk"].id),
            "ingredient_name": "Oat Milk",
            "unit": "ml",
            "available": "1000.000",
            "required": "1250.000",
            "projected_balance": "-250.000",
        }
    ]
    assert balance(shop.ing["Oat Milk"]) == Decimal("1000.000")  # quote never deducts


def test_at26_tax_on_top_and_inclusive(barista_c, org, shop):
    s = OrganizationSettings.objects.get(organization=org)
    s.tax_enabled, s.tax_rate, s.prices_include_tax = True, Decimal("14.00"), False
    s.save()
    q = data(quote(barista_c, item(shop.large, 3)))  # 240.00 net
    assert (q["subtotal"], q["tax_total"], q["total"]) == ("240.00", "33.60", "273.60")
    assert q["tax"] == {"enabled": True, "rate": "14.00", "inclusive": False, "label": "VAT"}
    s.prices_include_tax = True
    s.save()
    q = data(quote(barista_c, item(shop.large, 3)))
    assert (q["tax_total"], q["total"]) == ("29.47", "240.00")  # 240*14/114 = 29.4737


def test_tax_disabled_by_default(barista_c, shop):
    q = data(quote(barista_c, item(shop.large)))
    assert q["tax"]["enabled"] is False and q["tax_total"] == "0.00"


@pytest.mark.parametrize(
    ("make", "status", "code"),
    [
        (lambda s: [], 422, "EMPTY_CART"),
        (lambda s: [item(s.small, 0)], 422, "INVALID_QUANTITY"),
        (lambda s: [item(s.small, 100)], 422, "INVALID_QUANTITY"),
        (lambda s: [{**item(s.small), "quantity": "2"}], 422, "INVALID_QUANTITY"),
        (lambda s: [{**item(s.small), "quantity": 1.5}], 422, "INVALID_QUANTITY"),
        (lambda s: [item(s.small, 1, [s.oat, s.oat])], 422, "MODIFIER_SELECTION_INVALID"),
    ],
)
def test_quote_errors(barista_c, shop, make, status, code):
    r = barista_c.post(Q, {"items": make(shop)}, format="json")
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_quote_modifier_rules(barista_c, shop):
    r = quote(barista_c, item(shop.small, 1, [shop.oat, shop.oat]))
    assert r.json()["error"]["code"] == "MODIFIER_SELECTION_INVALID"
    # oat is the only option in a max-1 group; a second option in the same group would break max
    from apps.modifiers.models import ModifierOption

    soy = ModifierOption.objects.create(
        organization=shop.oat.organization, group=shop.milk_group, label="Soy", price_delta="5.00"
    )
    r = quote(barista_c, item(shop.small, 1, [shop.oat, soy]))
    assert r.json()["error"]["code"] == "MODIFIER_SELECTION_INVALID"
    assert r.json()["error"]["details"]["max_select"] == 1


def test_inactive_things_are_unavailable(barista_c, shop):
    shop.large.is_active = False
    shop.large.save()
    assert quote(barista_c, item(shop.large)).json()["error"]["code"] == "ITEM_UNAVAILABLE"
    shop.shot.is_active = False
    shop.shot.save()
    assert (
        quote(barista_c, item(shop.small, 1, [shop.shot])).json()["error"]["code"]
        == "INVALID_MODIFIER"
    )


def test_missing_slot_and_option_without_effect_for_size(barista_c, shop):
    from apps.catalog.models import RecipeLine

    RecipeLine.objects.filter(variant=shop.small, slot_key="milk").delete()
    r = quote(barista_c, item(shop.small, 1, [shop.oat]))
    assert r.json()["error"]["code"] == "INVALID_MODIFIER"
    assert r.json()["error"]["details"]["reason"] == "slot_missing"
    from apps.modifiers.models import ModifierEffect

    ModifierEffect.objects.filter(option=shop.oat, variant=shop.large).delete()
    r = quote(barista_c, item(shop.large, 1, [shop.oat]))
    assert r.json()["error"]["details"]["reason"] == "no_effect_for_variant"


def test_other_orgs_variant_and_option_are_rejected(admin2_c, shop):
    assert quote(admin2_c, item(shop.small)).json()["error"]["code"] == "ITEM_UNAVAILABLE"


def test_anonymous_and_unknown_keys(anon, barista_c, shop):
    assert anon.post(Q, {"items": []}, format="json").status_code == 401
    r = barista_c.post(Q, {"items": [item(shop.small)], "extra": 1}, format="json")
    assert r.status_code == 400
