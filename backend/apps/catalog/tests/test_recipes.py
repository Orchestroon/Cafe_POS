import pytest

from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant, RecipeLine
from apps.inventory.models import Ingredient
from apps.modifiers.models import ModifierGroup, ProductModifierGroup
from conftest import data

pytestmark = pytest.mark.django_db


@pytest.fixture
def latte(org):
    cat = Category.objects.create(organization=org, name="Cold")
    prod = Product.objects.create(organization=org, category=cat, name="Iced Latte")
    small = ProductVariant.objects.create(
        organization=org, product=prod, label="Small", price="65.00"
    )
    large = ProductVariant.objects.create(
        organization=org, product=prod, label="Large", price="80.00"
    )
    return prod, small, large


@pytest.fixture
def ings(org):
    mk = lambda n, u: Ingredient.objects.create(organization=org, name=n, base_unit=u)  # noqa: E731
    return {"coffee": mk("Coffee", "g"), "milk": mk("Milk", "ml"), "cup": mk("Cup", "pcs")}


def put(c, variant, lines):
    return c.put(f"/api/v1/variants/{variant.id}/recipe", {"lines": lines}, format="json")


def line(ing, qty, waste="0.00", slot=None):
    return {"ingredient_id": str(ing.id), "base_qty": qty, "waste_pct": waste, "slot_key": slot}


def test_put_then_get_roundtrip_with_exact_decimals(admin_c, latte, ings):
    _, small, _ = latte
    r = put(
        admin_c,
        small,
        [
            line(ings["coffee"], "12.000", "5.00", "coffee"),
            line(ings["milk"], "200.000", slot="milk"),
        ],
    )
    assert r.status_code == 200
    got = data(admin_c.get(f"/api/v1/variants/{small.id}/recipe"))
    assert got["variant_id"] == str(small.id) and got["warnings"] == []
    by = {x["ingredient_name"]: x for x in got["lines"]}
    assert by["Coffee"]["base_qty"] == "12.000" and by["Coffee"]["waste_pct"] == "5.00"
    assert by["Coffee"]["unit"] == "g" and by["Milk"]["slot_key"] == "milk"


def test_put_replaces_wholesale_and_variants_are_independent(admin_c, latte, ings):
    _, small, large = latte
    put(admin_c, small, [line(ings["coffee"], "12.000"), line(ings["milk"], "200.000")])
    put(admin_c, large, [line(ings["coffee"], "18.000"), line(ings["milk"], "300.000")])
    put(admin_c, small, [line(ings["coffee"], "10.000")])
    assert RecipeLine.objects.filter(variant=small).count() == 1
    assert RecipeLine.objects.filter(variant=large).count() == 2


def test_empty_recipe_allowed(admin_c, latte, ings):
    _, small, _ = latte
    put(admin_c, small, [line(ings["coffee"], "1.000")])
    assert put(admin_c, small, []).status_code == 200
    assert RecipeLine.objects.filter(variant=small).count() == 0


@pytest.mark.parametrize(
    ("mutate", "problem"),
    [
        (lambda ing: line(ing, "-1.000"), "base_qty_negative"),
        (lambda ing: line(ing, "1.000", "100.01"), "waste_pct_out_of_range"),
        (lambda ing: line(ing, "1.000", "-0.01"), "waste_pct_out_of_range"),
    ],
)
def test_range_errors_are_invalid_recipe(admin_c, latte, ings, mutate, problem):
    _, small, _ = latte
    r = put(admin_c, small, [mutate(ings["coffee"])])
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_RECIPE"
    assert r.json()["error"]["details"]["lines"] == [{"index": 0, "problems": [problem]}]
    assert RecipeLine.objects.count() == 0


def test_duplicate_ingredient_and_slot_rejected(admin_c, latte, ings):
    _, small, _ = latte
    r = put(admin_c, small, [line(ings["coffee"], "1.000"), line(ings["coffee"], "2.000")])
    assert r.status_code == 422
    assert r.json()["error"]["details"]["lines"][0]["problems"] == ["duplicate_ingredient"]
    r = put(
        admin_c,
        small,
        [line(ings["coffee"], "1.000", slot="x"), line(ings["milk"], "2.000", slot="x")],
    )
    assert r.status_code == 422
    assert r.json()["error"]["details"]["lines"][0]["problems"] == ["duplicate_slot"]


def test_inactive_unknown_and_foreign_ingredient_rejected(admin_c, latte, ings, org2):
    _, small, _ = latte
    ings["milk"].is_active = False
    ings["milk"].save()
    foreign = Ingredient.objects.create(organization=org2, name="Foreign", base_unit="g")
    r = put(
        admin_c,
        small,
        [line(ings["milk"], "1.000"), line(foreign, "1.000")],
    )
    assert r.status_code == 422
    problems = {x["index"]: x["problems"] for x in r.json()["error"]["details"]["lines"]}
    assert problems == {0: ["ingredient_inactive"], 1: ["ingredient_not_found"]}


def test_numeric_json_and_unknown_keys_rejected(admin_c, latte, ings):
    _, small, _ = latte
    bad = {"ingredient_id": str(ings["coffee"].id), "base_qty": 12, "waste_pct": "0.00"}
    assert put(admin_c, small, [bad]).status_code == 400
    bad = {**line(ings["coffee"], "1.000"), "extra": 1}
    assert put(admin_c, small, [bad]).status_code == 400
    assert RecipeLine.objects.count() == 0


def test_warning_when_replace_slot_missing(admin_c, latte, ings, org):
    prod, small, _ = latte
    group = ModifierGroup.objects.create(
        organization=org, name="Milk Type", mode="replace", replacement_slot="milk", max_select=1
    )
    ProductModifierGroup.objects.create(organization=org, product=prod, group=group)
    r = put(admin_c, small, [line(ings["coffee"], "12.000", slot="coffee")])
    assert r.status_code == 200
    w = data(r)["warnings"]
    assert w == [
        {
            "code": "SLOT_MISSING",
            "group_id": str(group.id),
            "group_name": "Milk Type",
            "replacement_slot": "milk",
        }
    ]
    r = put(admin_c, small, [line(ings["milk"], "200.000", slot="milk")])
    assert data(r)["warnings"] == []


def test_audit_has_before_and_after(admin_c, latte, ings):
    _, small, _ = latte
    put(admin_c, small, [line(ings["coffee"], "12.000")])
    put(admin_c, small, [line(ings["coffee"], "14.000")])
    events = list(AuditEvent.objects.filter(action="recipe.replaced").order_by("created_at"))
    assert len(events) == 2
    assert events[1].summary["before"][0]["base_qty"] == "12.000"
    assert events[1].summary["after"][0]["base_qty"] == "14.000"
    # identical PUT is a no-op for the audit log
    put(admin_c, small, [line(ings["coffee"], "14.000")])
    assert AuditEvent.objects.filter(action="recipe.replaced").count() == 2


def test_other_org_variant_is_404(admin2_c, latte):
    _, small, _ = latte
    assert admin2_c.get(f"/api/v1/variants/{small.id}/recipe").status_code == 404
    assert put(admin2_c, small, []).status_code == 404


def test_barista_cannot_read_or_write_recipes(barista_c, latte):
    _, small, _ = latte
    assert barista_c.get(f"/api/v1/variants/{small.id}/recipe").status_code == 403
    assert put(barista_c, small, []).status_code == 403
