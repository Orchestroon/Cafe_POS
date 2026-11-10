import pytest

from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant
from apps.inventory.models import Ingredient
from apps.modifiers.models import ModifierEffect, ModifierGroup, ModifierOption
from conftest import data

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(org):
    cat = Category.objects.create(organization=org, name="Cold")
    prod = Product.objects.create(organization=org, category=cat, name="Iced Latte")
    small = ProductVariant.objects.create(organization=org, product=prod, label="S", price="65.00")
    large = ProductVariant.objects.create(organization=org, product=prod, label="L", price="80.00")
    oat = Ingredient.objects.create(organization=org, name="Oat Milk", base_unit="ml")
    coffee = Ingredient.objects.create(organization=org, name="Coffee", base_unit="g")
    return {"prod": prod, "small": small, "large": large, "oat": oat, "coffee": coffee}


def new_group(c, **kw):
    body = {"name": "Milk Type", "mode": "replace", "replacement_slot": "milk", "max_select": 1}
    body.update(kw)
    return c.post("/api/v1/modifier-groups", body, format="json")


def oat_body(w):
    return {
        "label": "Oat Milk",
        "price_delta": "15.00",
        "variant_prices": [{"variant_id": str(w["large"].id), "price_delta": "20.00"}],
        "effects": [
            {
                "variant_id": str(w["small"].id),
                "ingredient_id": str(w["oat"].id),
                "base_qty": "180.000",
            },
            {
                "variant_id": str(w["large"].id),
                "ingredient_id": str(w["oat"].id),
                "base_qty": "250.000",
            },
        ],
    }


def test_create_replace_group_and_option_with_prices_and_effects(admin_c, world):
    g = data(new_group(admin_c))
    assert g["mode"] == "replace" and g["options"] == [] and g["min_select"] == 0
    r = admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", oat_body(world), format="json")
    assert r.status_code == 201
    opt = data(r)
    assert opt["price_delta"] == "15.00"
    assert opt["variant_prices"] == [{"variant_id": str(world["large"].id), "price_delta": "20.00"}]
    assert {e["base_qty"] for e in opt["effects"]} == {"180.000", "250.000"}
    assert opt["effects"][0]["ingredient_name"] == "Oat Milk" and opt["effects"][0]["unit"] == "ml"
    assert AuditEvent.objects.filter(action="modifier_group.created").exists()
    assert AuditEvent.objects.filter(action="modifier_option.created").exists()


def test_extra_shot_add_group_all_sizes_effect(admin_c, world):
    g = data(new_group(admin_c, name="Extras", mode="add", replacement_slot=None, max_select=3))
    body = {
        "label": "Extra Shot",
        "price_delta": "20.00",
        "effects": [
            {
                "variant_id": None,
                "ingredient_id": str(world["coffee"].id),
                "base_qty": "8.000",
                "waste_pct": "5.00",
            }
        ],
    }
    r = admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", body, format="json")
    assert r.status_code == 201
    e = data(r)["effects"][0]
    assert e["variant_id"] is None and e["waste_pct"] == "5.00"


@pytest.mark.parametrize(
    "body",
    [
        {"mode": "replace", "replacement_slot": None},
        {"mode": "add", "replacement_slot": "milk"},
        {"mode": "add", "replacement_slot": None, "min_select": 3, "max_select": 2},
        {"mode": "add", "replacement_slot": None, "max_select": 0},
        {"mode": "bogus"},
    ],
)
def test_group_validation(admin_c, body):
    r = new_group(admin_c, **body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert ModifierGroup.objects.count() == 0


def test_duplicate_group_name_and_option_label_rejected(admin_c, world):
    g = data(new_group(admin_c))
    assert new_group(admin_c, name="milk type").status_code == 400
    url = f"/api/v1/modifier-groups/{g['id']}/options"
    assert admin_c.post(url, {"label": "Oat"}, format="json").status_code == 201
    assert admin_c.post(url, {"label": "oat"}, format="json").status_code == 400


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b, w: b["effects"][0].update(base_qty="-1.000"),
        lambda b, w: b["effects"][0].update(waste_pct="100.01"),
        lambda b, w: b["effects"][0].update(base_qty=5),
        lambda b, w: b["effects"].append(dict(b["effects"][0])),  # duplicate (size, ingredient)
        lambda b, w: b["variant_prices"].append(dict(b["variant_prices"][0])),
        lambda b, w: b.update(price_delta="-1.00"),
        lambda b, w: b["effects"][0].update(ingredient_id="00000000-0000-0000-0000-000000000000"),
        lambda b, w: b["variant_prices"][0].update(
            variant_id="00000000-0000-0000-0000-000000000000"
        ),
    ],
)
def test_option_validation_rejects_bad_input_and_writes_nothing(admin_c, world, mutate):
    g = data(new_group(admin_c))
    body = oat_body(world)
    mutate(body, world)
    r = admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", body, format="json")
    assert r.status_code == 400
    assert ModifierOption.objects.count() == 0 and ModifierEffect.objects.count() == 0


def test_effect_with_inactive_or_foreign_ingredient_rejected(admin_c, world, org2):
    g = data(new_group(admin_c))
    foreign = Ingredient.objects.create(organization=org2, name="X", base_unit="g")
    world["oat"].is_active = False
    world["oat"].save()
    for ing in (foreign, world["oat"]):
        body = {
            "label": "Z",
            "effects": [{"variant_id": None, "ingredient_id": str(ing.id), "base_qty": "1.000"}],
        }
        r = admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", body, format="json")
        assert r.status_code == 400


def test_patch_option_replaces_children_only_when_sent_and_audits(admin_c, world):
    g = data(new_group(admin_c))
    opt = data(
        admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", oat_body(world), format="json")
    )
    # label-only patch keeps effects and prices
    r = admin_c.patch(f"/api/v1/modifier-options/{opt['id']}", {"label": "Oat"}, format="json")
    assert r.status_code == 200 and len(data(r)["effects"]) == 2 and data(r)["label"] == "Oat"
    # sending effects replaces them wholesale
    r = admin_c.patch(
        f"/api/v1/modifier-options/{opt['id']}",
        {"effects": [], "variant_prices": []},
        format="json",
    )
    assert data(r)["effects"] == [] and data(r)["variant_prices"] == []
    ev = AuditEvent.objects.filter(action="modifier_option.updated").order_by("created_at").last()
    assert len(ev.summary["before"]["effects"]) == 2 and ev.summary["after"]["effects"] == []
    # unchanged patch is not audited
    n = AuditEvent.objects.filter(action="modifier_option.updated").count()
    admin_c.patch(f"/api/v1/modifier-options/{opt['id']}", {"label": "Oat"}, format="json")
    assert AuditEvent.objects.filter(action="modifier_option.updated").count() == n


def test_deactivate_option_hides_it_from_barista(admin_c, barista_c, world):
    g = data(new_group(admin_c))
    url = f"/api/v1/modifier-groups/{g['id']}/options"
    a = data(admin_c.post(url, {"label": "A"}, format="json"))
    admin_c.post(url, {"label": "B"}, format="json")
    admin_c.patch(f"/api/v1/modifier-options/{a['id']}", {"is_active": False}, format="json")
    barista = data(barista_c.get(f"/api/v1/modifier-groups/{g['id']}"))
    assert [o["label"] for o in barista["options"]] == ["B"]
    admin = data(admin_c.get(f"/api/v1/modifier-groups/{g['id']}"))
    assert {o["label"] for o in admin["options"]} == {"A", "B"}


def test_barista_sees_no_effects_slot_or_inactive_groups(admin_c, barista_c, world):
    g = data(new_group(admin_c))
    admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", oat_body(world), format="json")
    off = data(new_group(admin_c, name="Old", mode="add", replacement_slot=None))
    admin_c.patch(f"/api/v1/modifier-groups/{off['id']}", {"is_active": False}, format="json")
    seen = data(barista_c.get("/api/v1/modifier-groups"))
    assert [x["name"] for x in seen] == ["Milk Type"]
    assert "effects" not in seen[0]["options"][0] and "replacement_slot" not in seen[0]
    assert "slot_warnings" not in seen[0]
    assert seen[0]["options"][0]["variant_prices"]  # prices are what the POS needs


def test_slot_warnings_list_variants_missing_the_slot(admin_c, world, org):
    from apps.catalog.models import RecipeLine
    from apps.modifiers.models import ProductModifierGroup

    g = data(new_group(admin_c))
    ProductModifierGroup.objects.create(
        organization=org, product=world["prod"], group=ModifierGroup.objects.get(pk=g["id"])
    )
    RecipeLine.objects.create(
        organization=org,
        variant=world["small"],
        ingredient=world["oat"],
        base_qty="1",
        slot_key="milk",
    )
    got = data(admin_c.get(f"/api/v1/modifier-groups/{g['id']}"))
    assert [w["variant_label"] for w in got["slot_warnings"]] == ["L"]


def test_products_include_linked_groups_with_options(admin_c, barista_c, world):
    g = data(new_group(admin_c))
    admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", oat_body(world), format="json")
    r = admin_c.put(
        f"/api/v1/products/{world['prod'].id}/modifier-groups",
        [{"group_id": g["id"], "sort_order": 1}],
        format="json",
    )
    assert r.status_code == 200
    for c in (admin_c, barista_c):
        prod = data(c.get(f"/api/v1/products/{world['prod'].id}"))
        grp = prod["modifier_groups"][0]
        assert grp["name"] == "Milk Type" and grp["mode"] == "replace" and grp["max_select"] == 1
        assert grp["options"][0]["label"] == "Oat Milk"
        assert "effects" not in grp["options"][0]


def test_tenant_isolation(admin2_c, admin_c, world):
    g = data(new_group(admin_c))
    opt = data(
        admin_c.post(f"/api/v1/modifier-groups/{g['id']}/options", {"label": "A"}, format="json")
    )
    assert admin2_c.get("/api/v1/modifier-groups").json()["data"] == []
    assert admin2_c.get(f"/api/v1/modifier-groups/{g['id']}").status_code == 404
    assert (
        admin2_c.post(
            f"/api/v1/modifier-groups/{g['id']}/options", {"label": "B"}, format="json"
        ).status_code
        == 404
    )
    assert (
        admin2_c.patch(
            f"/api/v1/modifier-options/{opt['id']}", {"label": "B"}, format="json"
        ).status_code
        == 404
    )


def test_barista_cannot_write(barista_c, admin_c, world):
    g = data(new_group(admin_c))
    assert new_group(barista_c, name="Z").status_code == 403
    assert (
        barista_c.post(
            f"/api/v1/modifier-groups/{g['id']}/options", {"label": "A"}, format="json"
        ).status_code
        == 403
    )
    assert (
        barista_c.patch(
            f"/api/v1/modifier-groups/{g['id']}", {"name": "Q"}, format="json"
        ).status_code
        == 403
    )
