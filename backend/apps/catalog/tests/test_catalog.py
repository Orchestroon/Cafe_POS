import importlib
import threading

import pytest
from django.apps import apps as django_apps
from django.db import connection

from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant
from apps.catalog.serializers import CategorySerializer
from apps.modifiers.models import ModifierGroup
from conftest import client_for, data

pytestmark = pytest.mark.django_db


def make_latte(c):
    cat = data(c.post("/api/v1/categories", {"name": "Cold Drinks"}, format="json"))
    prod = data(
        c.post("/api/v1/products", {"category_id": cat["id"], "name": "Iced Latte"}, format="json")
    )
    for label, price in [("Small", "65.00"), ("Large", "80.00"), ("XL", "95.00")]:
        r = c.post(
            f"/api/v1/products/{prod['id']}/variants",
            {"label": label, "price": price, "sku": f"LATTE-{label}"},
            format="json",
        )
        assert r.status_code == 201
    return cat, prod


def test_at01_iced_latte_three_sizes_different_prices(admin_c):
    """AT-01: Admin creates Iced Latte with 3 sizes; different prices, no code change."""
    _, prod = make_latte(admin_c)
    got = data(admin_c.get(f"/api/v1/products/{prod['id']}"))
    assert got["name"] == "Iced Latte"
    assert {v["label"]: v["price"] for v in got["variants"]} == {
        "Small": "65.00",
        "Large": "80.00",
        "XL": "95.00",
    }
    assert got["modifier_groups"] == []


def test_variant_price_change_is_audited_before_after(admin_c):
    _, prod = make_latte(admin_c)
    vid = ProductVariant.objects.get(label="Large").id
    r = admin_c.patch(f"/api/v1/variants/{vid}", {"price": "85.00"}, format="json")
    assert r.status_code == 200 and data(r)["price"] == "85.00"
    ev = AuditEvent.objects.get(action="variant.updated")
    assert ev.summary["changes"]["price"] == {"before": "80.00", "after": "85.00"}


def test_deactivate_variant_hidden_from_barista_but_kept_for_admin(admin_c, barista_c):
    _, prod = make_latte(admin_c)
    vid = ProductVariant.objects.get(label="XL").id
    admin_c.patch(f"/api/v1/variants/{vid}", {"is_active": False}, format="json")
    barista_labels = [
        v["label"] for v in data(barista_c.get(f"/api/v1/products/{prod['id']}"))["variants"]
    ]
    admin_labels = [
        v["label"] for v in data(admin_c.get(f"/api/v1/products/{prod['id']}"))["variants"]
    ]
    assert barista_labels == ["Small", "Large"] and len(admin_labels) == 3


def test_barista_sees_only_active_products_and_categories(admin_c, barista_c):
    cat, prod = make_latte(admin_c)
    assert barista_c.get("/api/v1/products").json()["meta"]["total_count"] == 1
    admin_c.patch(f"/api/v1/categories/{cat['id']}", {"is_active": False}, format="json")
    assert barista_c.get("/api/v1/products").json()["meta"]["total_count"] == 0
    assert barista_c.get("/api/v1/categories").json()["meta"]["total_count"] == 0
    assert barista_c.get(f"/api/v1/products/{prod['id']}").status_code == 404
    assert admin_c.get("/api/v1/categories").json()["meta"]["total_count"] == 1


def test_validation_money_strings_uniqueness(admin_c):
    cat, prod = make_latte(admin_c)
    url = f"/api/v1/products/{prod['id']}/variants"
    assert (
        admin_c.post(url, {"label": "Tiny", "price": 50}, format="json").status_code == 400
    )  # number
    assert admin_c.post(url, {"label": "Tiny", "price": "-1.00"}, format="json").status_code == 400
    assert admin_c.post(url, {"label": "Tiny", "price": "1.005"}, format="json").status_code == 400
    assert admin_c.post(url, {"label": "small", "price": "1.00"}, format="json").status_code == 400
    assert (
        admin_c.post(
            url, {"label": "T", "price": "1.00", "sku": "LATTE-XL"}, format="json"
        ).status_code
        == 400
    )
    assert (
        admin_c.post("/api/v1/categories", {"name": "cold drinks"}, format="json").status_code
        == 400
    )
    r = admin_c.post(
        "/api/v1/products", {"category_id": cat["id"], "name": "iced latte"}, format="json"
    )
    assert r.status_code == 400
    assert ProductVariant.objects.count() == 3


def test_a_blank_sku_gets_the_next_automatic_code(admin_c):
    """D22: SKU-00001, SKU-00002 ... for sizes saved without one; a typed SKU is kept."""
    _, prod = make_latte(admin_c)  # three typed SKUs: they do not use up numbers
    url = f"/api/v1/products/{prod['id']}/variants"
    skus = []
    for label, sku in [("A", ""), ("B", None), ("C", "MY-CODE")]:
        body = {"label": label, "price": "1.00"} | ({} if sku is None else {"sku": sku})
        r = admin_c.post(url, body, format="json")
        assert r.status_code == 201
        skus.append(data(r)["sku"])
    assert skus == ["SKU-00001", "SKU-00002", "MY-CODE"]


def test_an_automatic_code_skips_a_number_a_typed_sku_already_took(admin_c):
    _, prod = make_latte(admin_c)
    url = f"/api/v1/products/{prod['id']}/variants"
    admin_c.post(url, {"label": "A", "price": "1.00", "sku": "SKU-00001"}, format="json")
    r = admin_c.post(url, {"label": "B", "price": "1.00"}, format="json")
    assert data(r)["sku"] == "SKU-00002"


def test_clearing_a_sku_gives_a_new_code_and_other_edits_keep_it(admin_c):
    _, prod = make_latte(admin_c)
    url = f"/api/v1/products/{prod['id']}/variants"
    v = data(admin_c.post(url, {"label": "A", "price": "1.00"}, format="json"))
    edit = admin_c.patch(f"/api/v1/variants/{v['id']}", {"price": "2.00"}, format="json")
    assert data(edit)["sku"] == v["sku"] == "SKU-00001"
    cleared = admin_c.patch(f"/api/v1/variants/{v['id']}", {"sku": ""}, format="json")
    assert data(cleared)["sku"] == "SKU-00002"


def test_the_setup_screen_path_also_numbers_blank_skus(admin_c):
    cat = data(admin_c.post("/api/v1/categories", {"name": "Hot"}, format="json"))
    body = {
        "product": {"category_id": cat["id"], "name": "Tea"},
        "variants": [
            {"label": "S", "price": "10.00", "sku": "", "track_stock": False},
            {"label": "L", "price": "12.00", "sku": "TEA-L", "track_stock": False},
        ],
    }
    r = admin_c.post("/api/v1/products/setup", body, format="json")
    assert r.status_code == 201, r.content
    assert sorted(ProductVariant.objects.values_list("sku", flat=True)) == ["SKU-00001", "TEA-L"]


def test_product_modifier_group_links_replace_and_audit(admin_c, org):
    _, prod = make_latte(admin_c)
    g1 = ModifierGroup.objects.create(
        organization=org, name="Milk", mode="replace", replacement_slot="milk"
    )
    g2 = ModifierGroup.objects.create(organization=org, name="Extras", mode="add", max_select=3)
    url = f"/api/v1/products/{prod['id']}/modifier-groups"
    r = admin_c.put(
        url,
        [{"group_id": str(g1.id), "sort_order": 2}, {"group_id": str(g2.id), "sort_order": 1}],
        format="json",
    )
    assert r.status_code == 200
    assert [g["name"] for g in data(r)["modifier_groups"]] == ["Extras", "Milk"]
    r = admin_c.put(url, [{"group_id": str(g1.id)}], format="json")
    assert [g["name"] for g in data(r)["modifier_groups"]] == ["Milk"]
    assert AuditEvent.objects.filter(action="product.modifier_groups_replaced").count() == 2
    assert (
        admin_c.put(
            url, [{"group_id": str(g1.id)}, {"group_id": str(g1.id)}], format="json"
        ).status_code
        == 400
    )
    assert (
        admin_c.put(
            url, [{"group_id": "00000000-0000-0000-0000-000000000000"}], format="json"
        ).status_code
        == 400
    )


def test_cannot_link_other_orgs_group(admin_c, org2):
    _, prod = make_latte(admin_c)
    foreign = ModifierGroup.objects.create(organization=org2, name="Milk", mode="add")
    r = admin_c.put(
        f"/api/v1/products/{prod['id']}/modifier-groups",
        [{"group_id": str(foreign.id)}],
        format="json",
    )
    assert r.status_code == 400


def test_modifier_group_db_constraints(org):
    from django.db import IntegrityError, transaction

    for kw in (
        {"mode": "replace"},  # slot required
        {"mode": "add", "replacement_slot": "x"},  # slot only for replace
        {"mode": "add", "min_select": 3, "max_select": 2},
        {"mode": "add", "max_select": 0},
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            ModifierGroup.objects.create(organization=org, name=str(kw), **kw)


def test_product_list_filters_and_pagination(admin_c):
    cat, _ = make_latte(admin_c)
    for i in range(25):
        admin_c.post(
            "/api/v1/products", {"category_id": cat["id"], "name": f"P{i:02d}"}, format="json"
        )
    r = admin_c.get("/api/v1/products?page_size=10&page=3").json()
    assert r["meta"] == {"page": 3, "page_size": 10, "total_count": 26}
    assert admin_c.get("/api/v1/products?search=latte").json()["meta"]["total_count"] == 1
    assert admin_c.get("/api/v1/products?page_size=1000").json()["meta"]["page_size"] == 100


def test_malformed_category_filter_is_400(admin_c):
    r = admin_c.get("/api/v1/products?category_id=abc")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_lost_uniqueness_race_is_400_not_500(admin_c, monkeypatch):
    assert admin_c.post("/api/v1/categories", {"name": "Cold"}, format="json").status_code == 201
    monkeypatch.setattr(CategorySerializer, "validate_name", lambda self, v: v)  # check raced
    r = admin_c.post("/api/v1/categories", {"name": "Cold"}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert Category.objects.filter(name="Cold").count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_price_edits_audit_a_consistent_chain(org, admin):
    cat = Category.objects.create(organization=org, name="C")
    prod = Product.objects.create(organization=org, category=cat, name="P")
    v = ProductVariant.objects.create(organization=org, product=prod, label="S", price="10.00")
    statuses, barrier = [], threading.Barrier(2)

    def work(price):
        try:
            c = client_for(admin)
            barrier.wait()
            r = c.patch(f"/api/v1/variants/{v.id}", {"price": price}, format="json")
            statuses.append(r.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=work, args=(p,)) for p in ("20.00", "30.00")]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert statuses == [200, 200]
    events = AuditEvent.objects.filter(action="variant.updated").order_by("created_at")
    chain = [
        (e.summary["changes"]["price"]["before"], e.summary["changes"]["price"]["after"])
        for e in events
    ]
    assert chain[0][0] == "10.00" and chain[1][0] == chain[0][1]  # 2nd "before" = 1st "after"


def test_the_sku_backfill_numbers_old_sizes_oldest_first_and_resumes_the_counter(admin_c):
    from apps.core.models import Sequence

    make_latte(admin_c)  # LATTE-Small / Large / XL
    ProductVariant.objects.filter(label="Small").update(sku=None)
    ProductVariant.objects.filter(label="XL").update(sku="SKU-00001")  # typed, takes number 1
    ProductVariant.objects.filter(label="Large").update(sku="")
    Sequence.objects.all().delete()
    importlib.import_module("apps.catalog.migrations.0004_auto_sku").give_skus(django_apps, None)
    got = dict(ProductVariant.objects.values_list("label", "sku"))
    assert got == {"Small": "SKU-00002", "Large": "SKU-00003", "XL": "SKU-00001"}
    assert Sequence.objects.get(name="sku").last_number == 3
    r = admin_c.post(
        f"/api/v1/products/{ProductVariant.objects.first().product_id}/variants",
        {"label": "New", "price": "1.00"},
        format="json",
    )
    assert data(r)["sku"] == "SKU-00004"
