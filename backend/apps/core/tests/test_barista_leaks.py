"""Sprint 4 permission sweep (spec 11, section 6): every response a Barista can get is scanned for
admin-only data. One list of forbidden keys, one recursive check, every shared route (taken from
the permission matrix, so a new shared route is scanned automatically)."""

import pytest

from apps.core.tests.test_permissions_matrix import BOTH, MATRIX
from apps.inventory.models import Ingredient
from apps.sales.tests.conftest import cash, checkout, item, open_shift, refund
from conftest import data

pytestmark = pytest.mark.django_db

# Admin-only data: ingredient costs, recipes and modifier effects, consumption internals,
# purchasing, organization secrets and anything password-like.
FORBIDDEN = {
    "reference_unit_cost",
    "unit_cost",
    "cost",
    "effects",
    "recipe",
    "recipe_snapshot",
    "consumption_snapshot",
    "base_qty",
    "waste_pct",
    "slot_key",
    "replacement_slot",
    "slot_warnings",
    "invoice_prefix",
    "supplier",
    "supplier_id",
    "supplier_invoice_no",
    "password",
    "password_hash",
}


def leaks(obj, path="$"):
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in FORBIDDEN:
                found.append(f"{path}.{k}")
            found += leaks(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            found += leaks(v, f"{path}[{i}]")
    return found


@pytest.fixture
def world(shop, barista_c, org):
    """A café with costs, recipes and effects, an order with modifiers and a refund."""
    Ingredient.objects.filter(organization=org).update(reference_unit_cost="0.5000")
    shift = open_shift(barista_c)
    r = checkout(
        barista_c,
        [item(shop.large, options=[shop.oat, shop.shot])],
        [cash("120.00")],
        "120.00",
    )
    assert r.status_code == 201, r.content
    sold = data(r)
    paid = data(checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00"))
    refunded = data(refund(barista_c, paid["order_id"], "65.00"))
    return {
        "shop": shop,
        "shift": shift["id"],
        "order": sold["order_id"],
        "category": str(shop.product.category_id),
        "product": str(shop.product.pk),
        "group": str(shop.milk_group.pk),
        "responses": {"checkout": sold, "refund": refunded, "open_shift": shift},
    }


def _shared_get_routes():
    return [r for m, r, a in MATRIX if a == BOTH and m == "GET"]


def test_every_shared_read_route_is_scanned(world, barista_c):
    for route in _shared_get_routes():
        r = barista_c.get("/api/v1/" + route.format(**world))
        assert r.status_code == 200, (route, r.content)
        assert leaks(r.json()) == [], route


def test_write_responses_a_barista_gets_have_no_admin_data(world, barista_c):
    for name, body in world["responses"].items():
        assert leaks(body) == [], name
    s = world["shop"]
    q = barista_c.post(
        "/api/v1/orders/quote",
        {"items": [item(s.large, options=[s.oat])]},
        format="json",
    )
    assert q.status_code == 200 and leaks(q.json()) == []  # spec 8.3: consumption qty is allowed
    e = barista_c.post(
        "/api/v1/expenses",
        {"category": "supplies", "description": "Ice", "amount": "5.00"},
        format="json",
    )
    assert e.status_code == 201 and leaks(e.json()) == []
    c = barista_c.post(
        f"/api/v1/shifts/{world['shift']}/close", {"actual_closing_cash": "100.00"}, format="json"
    )
    assert c.status_code == 200 and leaks(c.json()) == []


def test_the_same_reads_do_show_admin_data_to_an_admin(world, admin_c):
    """Guards the scanner itself: it must find what an Admin legitimately sees."""
    order = admin_c.get(f"/api/v1/orders/{world['order']}").json()
    assert any(p.endswith(".recipe") for p in leaks(order))
    groups = admin_c.get("/api/v1/modifier-groups").json()
    assert any(p.endswith(".effects") for p in leaks(groups))
