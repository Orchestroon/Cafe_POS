"""B3 and R2 (owner, 2026-11-11): a size with no recipe and an option with no ingredient effect are
never sold silently. They need a recipe/effect, or an explicit "No stock tracking" /
"No stock effect" flag set by an Admin (audited)."""

import pytest

from apps.audit.models import AuditEvent
from apps.catalog.models import ProductVariant
from apps.inventory.models import StockMovement
from apps.modifiers.models import ModifierOption
from conftest import data

from .conftest import cash, checkout, item, open_shift
from .test_checkout import state

pytestmark = pytest.mark.django_db


@pytest.fixture
def shift(barista_c):
    return open_shift(barista_c)


@pytest.fixture
def water(org, shop):
    """A new size with no recipe: tracked by default (the migration default too)."""
    return ProductVariant.objects.create(
        organization=org, product=shop.product, label="Water", price="10.00", sort_order=5
    )


def quote(client, items):
    return client.post("/api/v1/orders/quote", {"items": items}, format="json")


# ---- B3: sizes ------------------------------------------------------------------------------


def test_new_size_is_tracked_and_reports_no_recipe(admin_c, shop, water):
    prods = data(admin_c.get("/api/v1/products"))
    sizes = {v["label"]: v for p in prods for v in p["variants"]}
    assert sizes["Water"]["track_stock"] is True and sizes["Water"]["has_recipe"] is False
    assert sizes["Small"]["track_stock"] is True and sizes["Small"]["has_recipe"] is True


def test_barista_sees_the_flags_needed_by_the_till(barista_c, shop, water):
    prods = data(barista_c.get("/api/v1/products"))
    water_row = next(v for p in prods for v in p["variants"] if v["label"] == "Water")
    assert water_row["has_recipe"] is False and water_row["track_stock"] is True


def test_quote_and_checkout_refuse_a_tracked_size_without_recipe(barista_c, shop, water, shift):
    r = quote(barista_c, [item(water)])
    assert r.status_code == 422 and r.json()["error"]["code"] == "RECIPE_MISSING"
    assert r.json()["error"]["details"]["variant_id"] == str(water.pk)
    before = state()
    r = checkout(barista_c, [item(water)], [cash("10.00")], "10.00")
    assert r.status_code == 422 and r.json()["error"]["code"] == "RECIPE_MISSING"
    assert state() == before  # nothing written, invoice number not used


def test_a_cart_with_one_bad_line_sells_nothing(barista_c, shop, water, shift):
    before = state()
    r = checkout(barista_c, [item(shop.small), item(water)], [cash("75.00")], "75.00")
    assert r.status_code == 422 and state() == before


def test_untracked_size_sells_with_no_stock_movement(admin_c, barista_c, shop, water, shift):
    r = admin_c.patch(f"/api/v1/variants/{water.pk}", {"track_stock": False}, format="json")
    assert r.status_code == 200 and data(r)["track_stock"] is False
    ev = AuditEvent.objects.filter(action="variant.updated", entity_id=water.pk).get()
    assert ev.summary["changes"]["track_stock"] == {"before": "True", "after": "False"}
    moves = StockMovement.objects.count()
    r = checkout(barista_c, [item(water)], [cash("10.00")], "10.00")
    assert r.status_code == 201, r.content
    assert StockMovement.objects.count() == moves


def test_tracking_cannot_be_turned_off_while_a_recipe_exists(admin_c, shop):
    r = admin_c.patch(f"/api/v1/variants/{shop.small.pk}", {"track_stock": False}, format="json")
    assert r.status_code == 400 and "track_stock" in r.json()["error"]["details"]["fields"]
    shop.small.refresh_from_db()
    assert shop.small.track_stock is True
    assert not AuditEvent.objects.filter(action="variant.updated").exists()


def test_recipe_cannot_be_added_to_an_untracked_size(admin_c, shop, water):
    admin_c.patch(f"/api/v1/variants/{water.pk}", {"track_stock": False}, format="json")
    line = {"ingredient_id": str(shop.ing["Cup"].pk), "base_qty": "1"}
    r = admin_c.put(f"/api/v1/variants/{water.pk}/recipe", {"lines": [line]}, format="json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_RECIPE"
    assert r.json()["error"]["details"]["reason"] == "stock_not_tracked"
    # An empty recipe is still accepted (nothing to deduct).
    r = admin_c.put(f"/api/v1/variants/{water.pk}/recipe", {"lines": []}, format="json")
    assert r.status_code == 200


def test_adding_a_recipe_makes_a_tracked_size_sellable(admin_c, barista_c, shop, water, shift):
    line = {"ingredient_id": str(shop.ing["Cup"].pk), "base_qty": "1"}
    r = admin_c.put(f"/api/v1/variants/{water.pk}/recipe", {"lines": [line]}, format="json")
    assert r.status_code == 200
    r = checkout(barista_c, [item(water)], [cash("10.00")], "10.00")
    assert r.status_code == 201, r.content


def test_barista_cannot_change_track_stock(barista_c, water):
    r = barista_c.patch(f"/api/v1/variants/{water.pk}", {"track_stock": False}, format="json")
    assert r.status_code == 403
    water.refresh_from_db()
    assert water.track_stock is True


# ---- R2: options ----------------------------------------------------------------------------


def _new_option(admin_c, group, **body):
    return admin_c.post(
        f"/api/v1/modifier-groups/{group.pk}/options",
        {"label": "Caramel", "price_delta": "5.00", **body},
        format="json",
    )


def test_option_without_effect_is_refused_at_the_till(admin_c, barista_c, shop, shift):
    r = _new_option(admin_c, shop.extras)
    assert r.status_code == 201, r.content
    opt = data(r)
    assert opt["track_stock"] is True and opt["effects"] == []
    caramel = ModifierOption.objects.get(pk=opt["id"])
    r = quote(barista_c, [item(shop.small, options=[caramel])])
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "INVALID_MODIFIER" and err["details"]["reason"] == "no_effect"
    before = state()
    r = checkout(barista_c, [item(shop.small, options=[caramel])], [cash("70.00")], "70.00")
    assert r.status_code == 422 and state() == before


def test_no_stock_effect_option_sells_and_deducts_only_the_recipe(admin_c, barista_c, shop, shift):
    r = _new_option(admin_c, shop.extras, label="No ice", price_delta="0.00", track_stock=False)
    assert r.status_code == 201 and data(r)["track_stock"] is False
    no_ice = ModifierOption.objects.get(pk=data(r)["id"])
    r = checkout(barista_c, [item(shop.small, options=[no_ice])], [cash("65.00")], "65.00")
    assert r.status_code == 201, r.content
    sold = {m.ingredient.name for m in StockMovement.objects.filter(movement_type="sale")}
    assert sold == {"Coffee Beans", "Whole Milk", "Cup"}


def test_no_stock_effect_cannot_keep_effects(admin_c, shop):
    eff = {"variant_id": None, "ingredient_id": str(shop.ing["Cup"].pk), "base_qty": "1"}
    r = _new_option(admin_c, shop.extras, track_stock=False, effects=[eff])
    assert r.status_code == 400 and "track_stock" in r.json()["error"]["details"]["fields"]
    assert not ModifierOption.objects.filter(label="Caramel").exists()
    r = admin_c.patch(
        f"/api/v1/modifier-options/{shop.shot.pk}", {"track_stock": False}, format="json"
    )
    assert r.status_code == 400
    shop.shot.refresh_from_db()
    assert shop.shot.track_stock is True
    # Turning it off together with removing the effects is accepted and audited.
    r = admin_c.patch(
        f"/api/v1/modifier-options/{shop.shot.pk}",
        {"track_stock": False, "effects": []},
        format="json",
    )
    assert r.status_code == 200 and data(r)["track_stock"] is False
    ev = AuditEvent.objects.filter(action="modifier_option.updated", entity_id=shop.shot.pk).get()
    assert ev.summary["before"]["track_stock"] is True
    assert ev.summary["after"]["track_stock"] is False


def test_barista_option_list_has_track_flag_but_no_effects(barista_c, shop):
    prods = data(barista_c.get("/api/v1/products"))
    opts = [o for g in prods[0]["modifier_groups"] for o in g["options"]]
    assert opts and all("track_stock" in o and "effects" not in o for o in opts)
