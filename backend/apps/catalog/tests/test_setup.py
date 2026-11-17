"""Product setup (owner, 2026-11-16): the Products & recipes screen saves the product, its sizes,
their recipes and its modifier links in ONE transaction. Same rules and audit as the separate
endpoints; any error saves nothing."""

import pytest

from apps.audit.models import AuditEvent
from apps.catalog.models import Product, ProductVariant, RecipeLine
from conftest import data

pytestmark = pytest.mark.django_db


def url(product):
    return f"/api/v1/products/{product.pk}/setup"


def line(ing, qty, waste="0.00", slot=None):
    return {"ingredient_id": str(ing.pk), "base_qty": qty, "waste_pct": waste, "slot_key": slot}


def snapshot():
    return (
        Product.objects.count(),
        ProductVariant.objects.count(),
        sorted(RecipeLine.objects.values_list("variant_id", "ingredient_id", "base_qty")),
        sorted(ProductVariant.objects.values_list("label", "price", "track_stock")),
        sorted(Product.objects.values_list("name", flat=True)),
        AuditEvent.objects.count(),
    )


def body(shop, **over):
    """The current state of the Iced Latte as the screen would send it."""
    ing = shop.ing
    small_recipe = [
        line(ing["Coffee Beans"], "12.000", "5.00", "coffee"),
        line(ing["Whole Milk"], "200.000", "0.00", "milk"),
        line(ing["Cup"], "1.000"),
    ]
    large_recipe = [
        line(ing["Coffee Beans"], "18.000", "5.00", "coffee"),
        line(ing["Whole Milk"], "300.000", "0.00", "milk"),
        line(ing["Cup"], "1.000"),
    ]
    b = {
        "product": {"name": "Iced Latte", "category_id": str(shop.product.category_id)},
        "variants": [
            {"id": str(shop.small.pk), "label": "Small", "price": "65.00", "recipe": small_recipe},
            {"id": str(shop.large.pk), "label": "Large", "price": "80.00", "recipe": large_recipe},
        ],
        "modifier_groups": [
            {"group_id": str(shop.milk_group.pk), "sort_order": 0},
            {"group_id": str(shop.extras.pk), "sort_order": 1},
        ],
    }
    b.update(over)
    return b


def test_get_returns_every_size_with_its_recipe_and_warnings(admin_c, shop):
    d = data(admin_c.get(url(shop.product)))
    assert d["name"] == "Iced Latte"
    sizes = {v["label"]: v for v in d["variants"]}
    assert set(sizes) == {"Small", "Large"}
    assert [x["ingredient_name"] for x in sizes["Small"]["recipe"]["lines"]] == [
        "Coffee Beans",
        "Whole Milk",
        "Cup",
    ]
    assert sizes["Small"]["recipe"]["warnings"] == []
    assert {g["name"] for g in d["modifier_groups"]} == {"Milk Type", "Extras"}


def test_unchanged_save_writes_no_audit(admin_c, shop):
    before = AuditEvent.objects.count()
    r = admin_c.put(url(shop.product), body(shop), format="json")
    assert r.status_code == 200, r.content
    assert AuditEvent.objects.count() == before


def test_one_save_changes_product_size_recipe_and_links_with_the_usual_audit(admin_c, shop):
    b = body(shop)
    b["product"]["name"] = "Iced Latte Classic"
    b["variants"][1]["price"] = "85.00"
    b["variants"][0]["recipe"][0]["base_qty"] = "14.000"
    b["modifier_groups"] = [{"group_id": str(shop.extras.pk), "sort_order": 0}]
    r = admin_c.put(url(shop.product), b, format="json")
    assert r.status_code == 200, r.content
    d = data(r)
    assert d["name"] == "Iced Latte Classic"
    sizes = {v["label"]: v for v in d["variants"]}
    assert sizes["Large"]["price"] == "85.00"
    assert sizes["Small"]["recipe"]["lines"][0]["base_qty"] == "14.000"
    assert [g["name"] for g in d["modifier_groups"]] == ["Extras"]
    actions = sorted(AuditEvent.objects.values_list("action", flat=True))
    for a in (
        "product.updated",
        "variant.updated",
        "recipe.replaced",
        "product.modifier_groups_replaced",
    ):
        assert actions.count(a) == 1, a


def test_an_error_in_the_second_size_saves_nothing(admin_c, shop):
    before = snapshot()
    b = body(shop)
    b["product"]["name"] = "Renamed"
    b["variants"][0]["price"] = "70.00"
    b["variants"][1]["recipe"].append(line(shop.ing["Cup"], "1.000"))  # duplicate ingredient
    r = admin_c.put(url(shop.product), b, format="json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_RECIPE"
    details = r.json()["error"]["details"]
    assert details["variant_index"] == 1 and details["lines"][0]["index"] == 3
    assert snapshot() == before


def test_size_field_errors_point_at_the_size(admin_c, shop):
    before = snapshot()
    b = body(shop)
    b["variants"][1]["price"] = "-1.00"
    r = admin_c.put(url(shop.product), b, format="json")
    assert r.status_code == 400
    d = r.json()["error"]["details"]
    assert d["part"] == "variant" and d["variant_index"] == 1 and "price" in d["fields"]
    assert snapshot() == before


def test_create_a_product_with_two_sizes_and_recipes(admin_c, barista_c, shop):
    ing = shop.ing
    b = {
        "product": {"name": "Flat White", "category_id": str(shop.product.category_id)},
        "variants": [
            {"label": "Regular", "price": "90.00", "recipe": [line(ing["Coffee Beans"], "18.000")]},
            {"label": "Double", "price": "110.00", "recipe": [line(ing["Coffee Beans"], "36.000")]},
        ],
    }
    r = admin_c.post("/api/v1/products/setup", b, format="json")
    assert r.status_code == 201, r.content
    d = data(r)
    assert [v["label"] for v in d["variants"]] == ["Regular", "Double"]
    assert all(v["has_recipe"] for v in d["variants"])
    created = {e.action for e in AuditEvent.objects.all()}
    assert {"product.created", "variant.created", "recipe.replaced"} <= created
    q = barista_c.post(
        "/api/v1/orders/quote",
        {
            "items": [
                {"variant_id": d["variants"][1]["id"], "quantity": 1, "modifier_option_ids": []}
            ]
        },
        format="json",
    )
    assert q.status_code == 200 and data(q)["total"] == "110.00"


def test_create_needs_at_least_one_size(admin_c, shop):
    before = snapshot()
    b = {"product": {"name": "Empty", "category_id": str(shop.product.category_id)}, "variants": []}
    r = admin_c.post("/api/v1/products/setup", b, format="json")
    assert r.status_code == 400 and r.json()["error"]["details"]["part"] == "variants"
    assert snapshot() == before


def test_b3_no_stock_tracking_with_recipe_lines_is_refused(admin_c, shop):
    before = snapshot()
    b = body(shop)
    b["variants"][0]["track_stock"] = False
    r = admin_c.put(url(shop.product), b, format="json")
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["details"]["reason"] == "stock_not_tracked" and err["details"]["variant_index"] == 0
    assert snapshot() == before


def test_b3_switching_a_size_to_no_tracking_clears_its_recipe(admin_c, shop):
    b = body(shop)
    b["variants"][0]["track_stock"] = False
    b["variants"][0]["recipe"] = []
    r = admin_c.put(url(shop.product), b, format="json")
    assert r.status_code == 200, r.content
    shop.small.refresh_from_db()
    assert shop.small.track_stock is False and not shop.small.recipe_lines.exists()


def test_duplicate_size_names_and_unknown_fields_are_refused(admin_c, shop):
    before = snapshot()
    b = body(shop)
    b["variants"][1]["label"] = "small"
    assert admin_c.put(url(shop.product), b, format="json").status_code == 400
    b = body(shop)
    b["product"]["variants"] = []
    assert admin_c.put(url(shop.product), b, format="json").status_code == 400
    b = body(shop)
    b["variants"][0]["has_recipe"] = True
    assert admin_c.put(url(shop.product), b, format="json").status_code == 400
    assert snapshot() == before


def test_a_size_of_another_product_is_never_touched(admin_c, shop, org):
    other = Product.objects.create(organization=org, category=shop.product.category, name="Tea")
    tea = ProductVariant.objects.create(organization=org, product=other, label="Cup", price="20")
    before = snapshot()
    b = body(shop)
    b["variants"][0]["id"] = str(tea.pk)
    r = admin_c.put(url(shop.product), b, format="json")
    assert r.status_code == 400 and r.json()["error"]["details"]["fields"]["id"]
    assert snapshot() == before


def test_barista_and_other_cafe_are_refused(barista_c, admin2_c, shop):
    before = snapshot()
    assert barista_c.get(url(shop.product)).status_code == 403
    assert barista_c.put(url(shop.product), body(shop), format="json").status_code == 403
    assert admin2_c.get(url(shop.product)).status_code == 404
    assert admin2_c.put(url(shop.product), body(shop), format="json").status_code == 404
    assert snapshot() == before
