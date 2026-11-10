import threading
import uuid

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.sales.models import Order
from apps.sales.tests.conftest import (
    card,
    cash,
    checkout,
    close_shift,
    item,
    open_shift,
    refund,
    sell,
)
from apps.shifts.models import CashierShift
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db


@pytest.fixture
def shift(barista_c):
    return open_shift(barista_c, "100.00")


def test_at18_close_stores_expected_actual_and_difference(barista_c, barista, shop, shift):
    sell(barista_c, shop, [cash("65.00")], "65.00")
    sell(barista_c, shop, [card("65.00")], "65.00")
    r = close_shift(barista_c, shift["id"], "160.00", " short a bit ")
    assert r.status_code == 200, r.content
    d = data(r)
    assert d["status"] == "closed" and d["expected_cash"] == "165.00"
    assert d["actual_cash"] == "160.00" and d["difference"] == "-5.00"
    assert (
        d["close_note"] == "short a bit"
        and d["closed_at"]
        and d["closed_by"]["id"] == str(barista.pk)
    )
    assert d["totals"] == {
        "cash_sales": "65.00",
        "card_sales": "65.00",
        "cash_refunds": "0.00",
        "card_refunds": "0.00",
        "drawer_expenses": "0.00",
        "orders_count": 2,
        "expected_cash": "165.00",
    }
    row = CashierShift.objects.get()
    assert row.totals_snapshot == d["totals"] and str(row.difference) == "-5.00"
    ev = AuditEvent.objects.get(action="shift.closed")
    assert ev.summary["difference"] == "-5.00" and ev.summary["note"] == "short a bit"


def test_overage_is_a_positive_difference(barista_c, shift):
    assert data(close_shift(barista_c, shift["id"], "103.50"))["difference"] == "3.50"


def test_close_twice_is_409_and_keeps_the_first_close(barista_c, shift):
    assert close_shift(barista_c, shift["id"], "100.00").status_code == 200
    first = CashierShift.objects.values().get()
    r = close_shift(barista_c, shift["id"], "5.00")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_ALREADY_CLOSED"
    assert CashierShift.objects.values().get() == first
    assert AuditEvent.objects.filter(action="shift.closed").count() == 1


def test_expected_cash_subtracts_cash_refunds_but_not_card_refunds(barista_c, shop, shift):
    a = sell(barista_c, shop, [cash("65.00")], "65.00")
    b = sell(barista_c, shop, [card("65.00")], "65.00")
    refund(barista_c, a, "65.00")
    refund(barista_c, b, "65.00")
    d = data(close_shift(barista_c, shift["id"], "100.00"))
    assert d["expected_cash"] == "100.00" and d["difference"] == "0.00"
    assert d["totals"]["cash_refunds"] == "65.00" and d["totals"]["card_refunds"] == "65.00"


def test_a_barista_closes_only_their_own_shift_an_admin_any(org, barista_c, admin_c, admin, shift):
    other = client_for(make_user(org, "barista2", "barista"))
    r = close_shift(other, shift["id"], "0.00")
    assert r.status_code == 404 and CashierShift.objects.get().status == "open"
    assert other.get(f"/api/v1/shifts/{shift['id']}").status_code == 404
    r = close_shift(admin_c, shift["id"], "100.00", "closed for them")
    assert r.status_code == 200 and data(r)["closed_by"]["id"] == str(admin.pk)
    assert data(r)["user"]["display_name"] == "barista"


def test_after_closing_the_user_cannot_sell_but_can_open_a_new_shift(barista_c, shop, shift):
    close_shift(barista_c, shift["id"], "100.00")
    r = checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    assert data(barista_c.get("/api/v1/shifts/current")) is None
    assert open_shift(barista_c, "0.00")["id"] != shift["id"]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"actual_closing_cash": 5},
        {"actual_closing_cash": "-1.00"},
        {"actual_closing_cash": "1.00", "x": 1},
    ],
)
def test_close_validation(barista_c, shift, body):
    r = barista_c.post(f"/api/v1/shifts/{shift['id']}/close", body, format="json")
    assert r.status_code == 400 and CashierShift.objects.get().status == "open"


def test_unknown_and_foreign_shifts_are_404(admin2_c, barista_c, shift):
    assert close_shift(admin2_c, shift["id"], "1.00").status_code == 404
    assert admin2_c.get(f"/api/v1/shifts/{shift['id']}").status_code == 404
    assert close_shift(barista_c, uuid.uuid4(), "1.00").status_code == 404
    assert barista_c.get("/api/v1/shifts/not-a-uuid").status_code == 400


def test_shift_list_is_admin_only_and_filterable(org, admin_c, barista_c, barista, shift):
    other = client_for(make_user(org, "barista2", "barista"))
    s2 = open_shift(other, "0.00")
    close_shift(other, s2["id"], "0.00")
    assert barista_c.get("/api/v1/shifts").status_code == 403
    assert admin_c.get("/api/v1/shifts").json()["meta"]["total_count"] == 2
    assert admin_c.get("/api/v1/shifts?status=open").json()["meta"]["total_count"] == 1
    assert admin_c.get(f"/api/v1/shifts?user_id={barista.pk}").json()["meta"]["total_count"] == 1
    assert (
        admin_c.get("/api/v1/shifts?from=2000-01-01&to=2000-01-02").json()["meta"]["total_count"]
        == 0
    )
    assert admin_c.get("/api/v1/shifts?from=2000-01-01").json()["meta"]["total_count"] == 2
    row = next(r for r in admin_c.get("/api/v1/shifts?status=open").json()["data"])
    assert row["totals"]["expected_cash"] == "100.00"


def test_shift_list_does_not_leak_across_organizations(admin2_c, shift):
    assert admin2_c.get("/api/v1/shifts").json()["meta"]["total_count"] == 0


@pytest.mark.django_db(transaction=True)
def test_close_racing_checkouts_never_loses_a_sale(org, shop):
    user = make_user(org, "racer", "barista")
    c = client_for(user)
    s = open_shift(c, "10.00")
    start, codes = threading.Barrier(7), []

    def sale():
        try:
            start.wait()
            codes.append(
                checkout(client_for(user), [item(shop.small)], [cash("65.00")], "65.00").status_code
            )
        finally:
            connection.close()

    def close():
        try:
            start.wait()
            codes.append(("close", close_shift(client_for(user), s["id"], "0.00").status_code))
        finally:
            connection.close()

    ts = [threading.Thread(target=sale) for _ in range(6)] + [threading.Thread(target=close)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    shift = CashierShift.objects.get()
    sold = Order.objects.filter(shift=shift).count()
    assert shift.status == "closed" and sold == codes.count(201)
    # every committed sale is inside the frozen totals; every later one was refused
    assert shift.totals_snapshot["orders_count"] == sold
    assert shift.totals_snapshot["cash_sales"] == f"{65 * sold}.00"
    assert str(shift.expected_cash) == f"{10 + 65 * sold}.00"
    assert all(x in (201, 409) for x in codes if isinstance(x, int))
