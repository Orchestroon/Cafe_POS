import pytest

from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant
from apps.promotions.models import Promotion
from conftest import data

pytestmark = pytest.mark.django_db


@pytest.fixture
def menu(org):
    cat = Category.objects.create(organization=org, name="Drinks")
    food = Category.objects.create(organization=org, name="Food")
    p = Product.objects.create(organization=org, category=cat, name="Latte")
    cake = Product.objects.create(organization=org, category=food, name="Cake")
    return {
        "cat": cat,
        "food": food,
        "small": ProductVariant.objects.create(organization=org, product=p, label="S", price="60"),
        "slice": ProductVariant.objects.create(
            organization=org, product=cake, label="Slice", price="40"
        ),
    }


def body(menu, **kw):
    base = {
        "name": "Happy Hour",
        "kind": "discount",
        "is_active": True,
        "auto_apply": True,
        "scope": "variant",
        "discount_type": "percentage",
        "discount_value": "20.00",
        "variant_ids": [str(menu["small"].pk)],
        "category_ids": [],
        "combo_price": None,
        "slots": [],
        "starts_on": None,
        "ends_on": None,
        "days_of_week": [],
        "window_start": "15:00",
        "window_end": "17:00",
    }
    return {**base, **kw}


def combo(menu, **kw):
    return body(
        menu,
        name="Coffee + Cake",
        kind="combo",
        scope="",
        discount_type="",
        discount_value=None,
        variant_ids=[],
        combo_price="80.00",
        slots=[
            {"quantity": 1, "category_id": str(menu["cat"].pk), "variant_ids": []},
            {"quantity": 1, "category_id": None, "variant_ids": [str(menu["slice"].pk)]},
        ],
        **kw,
    )


def post(c, payload):
    return c.post("/api/v1/promotions", payload, format="json")


def test_admin_creates_a_discount_and_a_combo(admin_c, menu):
    r = post(admin_c, body(menu))
    assert r.status_code == 201, r.content
    d = data(r)
    assert d["name"] == "Happy Hour" and d["status"] == "active"
    assert d["window_start"] == "15:00" and d["variant_ids"] == [str(menu["small"].pk)]
    r = post(admin_c, combo(menu))
    assert r.status_code == 201, r.content
    assert data(r)["slots"][0]["category_id"] == str(menu["cat"].pk)
    assert Promotion.objects.count() == 2


def test_create_is_audited_in_words_not_ids(admin_c, menu):
    post(admin_c, body(menu))
    e = AuditEvent.objects.get(action="promotion.created")
    assert e.summary["after"]["variant_ids"] == "Latte (S)"
    assert e.summary["after"]["window_start"] == "15:00"


def test_only_an_admin_writes_a_barista_sees_names_only(admin_c, barista_c, anon, menu):
    pid = data(post(admin_c, body(menu)))["id"]
    post(admin_c, body(menu, name="Off", is_active=False))
    assert post(barista_c, body(menu, name="x")).status_code == 403
    assert (
        barista_c.patch(f"/api/v1/promotions/{pid}", {"name": "y"}, format="json").status_code
        == 403
    )
    rows = data(barista_c.get("/api/v1/promotions"))
    assert rows == [
        {"id": pid, "name": "Happy Hour", "kind": "discount", "auto_apply": True}
    ]  # inactive ones and the rules stay with the Admin
    assert anon.get("/api/v1/promotions").status_code in (401, 403)
    assert len(data(admin_c.get("/api/v1/promotions"))) == 2


def test_no_delete(admin_c, menu):
    pid = data(post(admin_c, body(menu)))["id"]
    assert admin_c.delete(f"/api/v1/promotions/{pid}").status_code == 405


def test_another_cafe_sees_and_uses_nothing_of_it(admin_c, admin2_c, menu, org2):
    pid = data(post(admin_c, body(menu)))["id"]
    assert admin2_c.get(f"/api/v1/promotions/{pid}").status_code == 404
    assert (
        admin2_c.patch(f"/api/v1/promotions/{pid}", {"name": "z"}, format="json").status_code == 404
    )
    assert data(admin2_c.get("/api/v1/promotions")) == []
    r = post(admin2_c, body(menu, name="mine"))  # sizes of the other café
    assert r.status_code == 400


@pytest.mark.parametrize(
    "change,field",
    [
        ({"discount_value": "101.00"}, "discount_value"),
        ({"discount_value": "0.00"}, "discount_value"),
        ({"discount_type": "fixed_amount", "discount_value": "0.00"}, "discount_value"),
        ({"variant_ids": []}, "variant_ids"),
        ({"scope": "category", "variant_ids": [], "category_ids": []}, "category_ids"),
        ({"scope": "order", "variant_ids": ["x"]}, "variant_ids"),
        ({"window_end": None}, "window_end"),
        ({"window_end": "15:00"}, "window_end"),
        ({"starts_on": "2026-12-02", "ends_on": "2026-12-01"}, "ends_on"),
        ({"days_of_week": [7]}, "days_of_week"),
        ({"name": "  "}, "name"),
        ({"discount_value": 20}, "discount_value"),  # money is a string
    ],
)
def test_discount_validation(admin_c, menu, change, field):
    r = post(admin_c, body(menu, **change))
    assert r.status_code == 400, r.content
    assert field in r.json()["error"]["details"]["fields"]


@pytest.mark.parametrize(
    "change,field",
    [
        ({"combo_price": None}, "combo_price"),
        ({"slots": []}, "slots"),
        ({"slots": [{"quantity": 1, "category_id": None, "variant_ids": []}]}, "slots"),
        ({"scope": "order"}, "scope"),
    ],
)
def test_combo_validation(admin_c, menu, change, field):
    r = post(admin_c, {**combo(menu), **change})
    assert r.status_code == 400, r.content
    assert field in r.json()["error"]["details"]["fields"]


def test_a_combo_of_one_item_is_refused(admin_c, menu):
    one = [{"quantity": 1, "category_id": str(menu["cat"].pk), "variant_ids": []}]
    assert post(admin_c, {**combo(menu), "slots": one}).status_code == 400


def test_name_is_unique_per_cafe_ignoring_case(admin_c, menu):
    post(admin_c, body(menu))
    assert post(admin_c, body(menu, name="happy hour")).status_code == 400


def test_unknown_field_is_rejected(admin_c, menu):
    assert post(admin_c, {**body(menu), "organization": "x"}).status_code == 400


def test_patch_changes_only_what_is_sent_and_is_audited(admin_c, menu):
    pid = data(post(admin_c, body(menu)))["id"]
    r = admin_c.patch(f"/api/v1/promotions/{pid}", {"is_active": False}, format="json")
    assert r.status_code == 200 and data(r)["status"] == "off" and data(r)["name"] == "Happy Hour"
    e = AuditEvent.objects.get(action="promotion.updated")
    assert e.summary["changes"] == {"is_active": {"before": "True", "after": "False"}}
    admin_c.patch(f"/api/v1/promotions/{pid}", {"is_active": False}, format="json")
    assert AuditEvent.objects.filter(action="promotion.updated").count() == 1  # nothing changed


def test_patch_revalidates_the_whole_promotion(admin_c, menu):
    pid = data(post(admin_c, body(menu)))["id"]
    r = admin_c.patch(f"/api/v1/promotions/{pid}", {"discount_value": "150.00"}, format="json")
    assert r.status_code == 400


def test_status_reflects_the_dates(admin_c, menu):
    past = data(post(admin_c, body(menu, name="old", ends_on="2020-01-01")))
    later = data(post(admin_c, body(menu, name="soon", starts_on="2099-01-01")))
    assert past["status"] == "expired" and past["live_now"] is False
    assert later["status"] == "scheduled" and later["live_now"] is False


def test_slots_are_replaced_when_the_combo_is_edited(admin_c, menu):
    pid = data(post(admin_c, combo(menu)))["id"]
    new = [{"quantity": 2, "category_id": str(menu["food"].pk), "variant_ids": []}]
    r = admin_c.patch(f"/api/v1/promotions/{pid}", {"slots": new}, format="json")
    assert data(r)["slots"] == [
        {"quantity": 2, "category_id": str(menu["food"].pk), "variant_ids": []}
    ]
