from types import SimpleNamespace

import pytest

from apps.catalog.models import Category, Product, ProductVariant, RecipeLine
from apps.inventory.models import Ingredient, StockBalance
from apps.inventory.services import set_opening_balances
from apps.modifiers.models import (
    ModifierEffect,
    ModifierGroup,
    ModifierOption,
    ModifierOptionPrice,
    ProductModifierGroup,
)
from apps.tenancy.seed import default_location


@pytest.fixture
def shop(org, admin):
    """Iced Latte (Small/Large), recipes, Milk Type (replace: Oat) and Extras (add: Extra Shot)."""
    o = {"organization": org}
    cat = Category.objects.create(name="Cold Drinks", **o)
    prod = Product.objects.create(category=cat, name="Iced Latte", **o)
    small = ProductVariant.objects.create(product=prod, label="Small", price="65.00", **o)
    large = ProductVariant.objects.create(
        product=prod, label="Large", price="80.00", sort_order=1, **o
    )
    ing = {}
    for name, unit in [
        ("Coffee Beans", "g"),
        ("Whole Milk", "ml"),
        ("Oat Milk", "ml"),
        ("Cup", "pcs"),
    ]:
        ing[name] = Ingredient.objects.create(name=name, base_unit=unit, **o)
        StockBalance.objects.create(ingredient=ing[name], location=default_location(org), **o)
    for v, coffee, milk in [(small, "12.000", "200.000"), (large, "18.000", "300.000")]:
        RecipeLine.objects.create(
            variant=v,
            ingredient=ing["Coffee Beans"],
            base_qty=coffee,
            waste_pct="5.00",
            slot_key="coffee",
            **o,
        )
        RecipeLine.objects.create(
            variant=v, ingredient=ing["Whole Milk"], base_qty=milk, slot_key="milk", **o
        )
        RecipeLine.objects.create(variant=v, ingredient=ing["Cup"], base_qty="1.000", **o)
    milk_g = ModifierGroup.objects.create(
        name="Milk Type", mode="replace", replacement_slot="milk", max_select=1, **o
    )
    oat = ModifierOption.objects.create(group=milk_g, label="Oat Milk", price_delta="15.00", **o)
    ModifierOptionPrice.objects.create(option=oat, variant=large, price_delta="20.00", **o)
    ModifierEffect.objects.create(
        option=oat, variant=small, ingredient=ing["Oat Milk"], base_qty="180.000", **o
    )
    ModifierEffect.objects.create(
        option=oat, variant=large, ingredient=ing["Oat Milk"], base_qty="250.000", **o
    )
    extras = ModifierGroup.objects.create(
        name="Extras", mode="add", max_select=3, sort_order=1, **o
    )
    shot = ModifierOption.objects.create(group=extras, label="Extra Shot", price_delta="20.00", **o)
    ModifierEffect.objects.create(
        option=shot,
        variant=None,
        ingredient=ing["Coffee Beans"],
        base_qty="8.000",
        waste_pct="5.00",
        **o,
    )
    ProductModifierGroup.objects.create(product=prod, group=milk_g, sort_order=0, **o)
    ProductModifierGroup.objects.create(product=prod, group=extras, sort_order=1, **o)
    set_opening_balances(
        admin,
        [
            {"ingredient_id": ing["Coffee Beans"].pk, "qty": "1000.000"},
            {"ingredient_id": ing["Whole Milk"].pk, "qty": "5000.000"},
            {"ingredient_id": ing["Oat Milk"].pk, "qty": "1000.000"},
            {"ingredient_id": ing["Cup"].pk, "qty": "100.000"},
        ],
    )
    return SimpleNamespace(
        product=prod,
        small=small,
        large=large,
        ing=ing,
        milk_group=milk_g,
        oat=oat,
        extras=extras,
        shot=shot,
    )


def item(variant, qty=1, options=()):
    return {
        "variant_id": str(variant.id),
        "quantity": qty,
        "modifier_option_ids": [str(o.id) for o in options],
    }


def balance(ingredient):
    return StockBalance.objects.get(ingredient=ingredient).qty


def open_shift(client, cash="100.00"):
    r = client.post("/api/v1/shifts/open", {"opening_cash": cash}, format="json")
    assert r.status_code == 201, r.content
    return r.json()["data"]


def checkout(client, items, payments, expected, key=None, **extra):
    import uuid

    body = {"items": items, "payments": payments, "expected_total": expected, **extra}
    return client.post(
        "/api/v1/orders/checkout",
        body,
        format="json",
        headers={"Idempotency-Key": str(key or uuid.uuid4())},
    )


def cash(amount, tendered=None):
    p = {"method": "cash", "amount": amount}
    if tendered is not None:
        p["cash_tendered"] = tendered
    return p


def card(amount, ref=None):
    p = {"method": "card", "amount": amount}
    if ref:
        p["external_reference"] = ref
    return p


def refund(client, order_id, amount, reason="Wrong drink", key=None, **extra):
    import uuid

    body = {"reason": reason, "confirm_amount": amount, **extra}
    return client.post(
        f"/api/v1/orders/{order_id}/refunds",
        body,
        format="json",
        headers={"Idempotency-Key": str(key or uuid.uuid4())},
    )


def close_shift(client, shift_id, actual, note=""):
    return client.post(
        f"/api/v1/shifts/{shift_id}/close",
        {"actual_closing_cash": actual, "note": note},
        format="json",
    )


def sell(client, shop, payments, total, qty=1, variant=None):
    """One sale of `qty` of the variant (default Small = 65.00) -> order id."""
    r = checkout(client, [item(variant or shop.small, qty)], payments, total)
    assert r.status_code == 201, r.content
    return r.json()["data"]["order_id"]
