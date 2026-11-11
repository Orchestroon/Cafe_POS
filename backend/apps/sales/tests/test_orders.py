from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.sales.models import Order
from apps.sales.selectors import local_today, org_timezone
from apps.tenancy.models import OrganizationSettings
from conftest import client_for, data, make_user

from .conftest import card, cash, checkout, item, open_shift

pytestmark = pytest.mark.django_db


@pytest.fixture
def sold(barista_c, shop):
    """Two orders by the barista: a cash one with Oat + Extra Shot, a card one."""
    open_shift(barista_c)
    a = data(
        checkout(
            barista_c,
            [item(shop.large, 1, [shop.oat, shop.shot])],
            [cash("120.00", "150.00")],
            "120.00",
        )
    )
    b = data(checkout(barista_c, [item(shop.small, 2)], [card("130.00", "t-1")], "130.00"))
    return a, b


def ids(r):
    return [o["invoice_no"] for o in data(r)]


def test_admin_lists_everything_newest_first_with_pagination_meta(admin_c, sold):
    r = admin_c.get("/api/v1/orders")
    assert ids(r) == ["POS-0000002", "POS-0000001"]
    assert r.json()["meta"] == {"page": 1, "page_size": 20, "total_count": 2}
    row = data(r)[0]
    assert row["status"] == "paid" and row["total"] == "130.00" and row["items_count"] == 2
    assert row["payment_methods"] == ["card"] and row["cashier"]["display_name"] == "barista"


def test_barista_sees_todays_orders_of_all_cashiers_but_not_old_ones(
    org, barista_c, admin_c, shop, sold
):
    other = make_user(org, "other", "barista")
    oc = client_for(other)
    open_shift(oc)
    checkout(oc, [item(shop.small)], [cash("65.00")], "65.00")
    old = Order.objects.get(invoice_no="POS-0000001")
    Order.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=3))
    assert ids(barista_c.get("/api/v1/orders")) == ["POS-0000003", "POS-0000002"]
    assert len(data(admin_c.get("/api/v1/orders"))) == 3


def test_barista_finds_an_old_order_by_exact_invoice_number_and_opens_it(barista_c, sold):
    old = Order.objects.get(invoice_no="POS-0000001")
    Order.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=30))
    assert "POS-0000001" not in ids(barista_c.get("/api/v1/orders"))
    r = barista_c.get("/api/v1/orders", {"invoice_no": "pos-0000001"})
    assert ids(r) == ["POS-0000001"]
    assert (
        barista_c.get("/api/v1/orders", {"invoice_no": "POS-000000"}).json()["data"] == []
    )  # exact only
    assert barista_c.get(f"/api/v1/orders/{old.pk}").status_code == 200
    assert barista_c.get(f"/api/v1/orders/{old.pk}/receipt").status_code == 200


def test_admin_filters(admin_c, sold, shop):
    a_id = Order.objects.get(invoice_no="POS-0000001")
    assert ids(admin_c.get("/api/v1/orders", {"status": "refunded"})) == []
    assert ids(admin_c.get("/api/v1/orders", {"shift_id": str(a_id.shift_id)})) == [
        "POS-0000002",
        "POS-0000001",
    ]
    assert ids(admin_c.get("/api/v1/orders", {"cashier_id": str(a_id.cashier_id)})) == [
        "POS-0000002",
        "POS-0000001",
    ]
    Order.objects.filter(pk=a_id.pk).update(created_at=timezone.now() - timedelta(days=10))
    # The café's local dates, not UTC: between 22:00 and 24:00 UTC Cairo is already on the next day.
    tz = org_timezone(a_id.organization)
    today = local_today(tz).isoformat()
    assert ids(admin_c.get("/api/v1/orders", {"from": today, "to": today})) == ["POS-0000002"]
    old_day = (local_today(tz) - timedelta(days=10)).isoformat()
    assert "POS-0000001" in ids(admin_c.get("/api/v1/orders", {"from": old_day, "to": old_day}))
    assert admin_c.get("/api/v1/orders", {"from": "garbage"}).status_code == 400
    assert admin_c.get("/api/v1/orders", {"cashier_id": "abc"}).status_code == 400


def test_detail_for_admin_has_snapshots_barista_does_not(admin_c, barista_c, sold):
    order = Order.objects.get(invoice_no="POS-0000001")
    adm = data(admin_c.get(f"/api/v1/orders/{order.pk}"))
    bar = data(barista_c.get(f"/api/v1/orders/{order.pk}"))
    assert adm["total"] == "120.00" and adm["tax"]["enabled"] is False and adm["refund"] is None
    it = adm["items"][0]
    assert it["product_name"] == "Iced Latte" and it["variant_label"] == "Large"
    assert [m["option_label"] for m in it["modifiers"]] == ["Oat Milk", "Extra Shot"]
    assert it["consumption"] and it["recipe"]
    assert "recipe" not in bar["items"][0] and "consumption" not in bar["items"][0]
    assert bar["payments"] == [
        {"method": "cash", "amount": "120.00", "cash_tendered": "150.00", "change_given": "30.00"}
    ]


def test_receipt_shape_and_values(org, barista_c, sold):
    OrganizationSettings.objects.filter(organization=org).update(
        business_name="Drip Café",
        receipt_header="Welcome",
        receipt_footer="Thanks",
        receipt_paper_width="58mm",
    )
    order = Order.objects.get(invoice_no="POS-0000001")
    rc = data(barista_c.get(f"/api/v1/orders/{order.pk}/receipt"))
    assert rc["business"] == {
        "name": "Drip Café",
        "header": "Welcome",
        "footer": "Thanks",
        "tax_registration_number": "",
    }
    assert rc["invoice_no"] == "POS-0000001" and rc["cashier"] == "barista"
    assert rc["items"] == [
        {
            "name": "Iced Latte",
            "variant": "Large",
            "quantity": 1,
            "modifiers": ["Oat Milk", "Extra Shot"],
            "unit_price": "120.00",
            "line_total": "120.00",
        }
    ]
    assert rc["subtotal"] == "120.00" and rc["total"] == "120.00" and rc["discount_total"] == "0.00"
    assert rc["tax"] == {
        "enabled": False,
        "label": "VAT",
        "rate": "0.00",
        "inclusive": False,
        "amount": "0.00",
    }
    assert rc["paper_width"] == "58mm" and rc["currency"] == "EGP" and rc["refund"] is None
    assert rc["payments"][0]["change_given"] == "30.00" and rc["created_at"].endswith("Z")


def test_receipt_is_a_snapshot_later_price_recipe_tax_changes_do_not_alter_it(
    org, admin_c, barista_c, shop, sold
):
    order = Order.objects.get(invoice_no="POS-0000002")
    before = data(barista_c.get(f"/api/v1/orders/{order.pk}/receipt"))
    shop.small.price = Decimal("99.00")
    shop.small.save()
    shop.small.product.name = "Renamed"
    shop.small.product.save()
    OrganizationSettings.objects.filter(organization=org).update(tax_enabled=True, tax_rate="14.00")
    assert data(barista_c.get(f"/api/v1/orders/{order.pk}/receipt")) == before


def test_receipt_shows_stored_tax(org, barista_c, shop):
    OrganizationSettings.objects.filter(organization=org).update(
        tax_enabled=True,
        tax_rate="14.00",
        prices_include_tax=False,
        tax_registration_number="123-456",
    )
    open_shift(barista_c)
    d = data(checkout(barista_c, [item(shop.large, 3)], [cash("273.60")], "273.60"))
    rc = data(barista_c.get(f"/api/v1/orders/{d['order_id']}/receipt"))
    assert rc["tax"] == {
        "enabled": True,
        "label": "VAT",
        "rate": "14.00",
        "inclusive": False,
        "amount": "33.60",
    }
    assert (rc["subtotal"], rc["total"]) == ("240.00", "273.60")
    assert rc["business"]["tax_registration_number"] == "123-456"


def test_other_organization_cannot_see_orders(admin2_c, sold):
    order = Order.objects.first()
    assert data(admin2_c.get("/api/v1/orders")) == []
    assert admin2_c.get(f"/api/v1/orders/{order.pk}").status_code == 404
    assert admin2_c.get(f"/api/v1/orders/{order.pk}/receipt").status_code == 404
    assert admin2_c.get("/api/v1/orders", {"invoice_no": order.invoice_no}).json()["data"] == []


def test_unknown_order_is_404_and_anonymous_is_401(admin_c, anon, sold):
    assert admin_c.get("/api/v1/orders/00000000-0000-0000-0000-000000000000").status_code == 404
    assert anon.get("/api/v1/orders").status_code == 401


def test_admin_from_only_ends_on_the_cafes_local_today(org, admin_c, sold):
    """M2: an empty "to" means today in the cafe's time zone, not the UTC date. UTC+14 makes the
    local date run ahead of UTC for most of the day."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    OrganizationSettings.objects.filter(organization=org).update(timezone="Pacific/Kiritimati")
    today = datetime.now(ZoneInfo("Pacific/Kiritimati")).date().isoformat()
    assert len(data(admin_c.get("/api/v1/orders", {"from": today}))) == 2
