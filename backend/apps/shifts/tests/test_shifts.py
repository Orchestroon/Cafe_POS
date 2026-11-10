import threading

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.shifts.models import CashierShift
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db


def test_current_is_null_before_opening(barista_c):
    r = barista_c.get("/api/v1/shifts/current")
    assert r.status_code == 200 and r.json() == {"data": None, "meta": {}}


def test_open_then_current_returns_live_totals(barista_c, barista):
    r = barista_c.post("/api/v1/shifts/open", {"opening_cash": "300.00"}, format="json")
    assert r.status_code == 201
    s = data(r)
    assert (
        s["status"] == "open" and s["opening_cash"] == "300.00" and s["register"] == "Main Register"
    )
    cur = data(barista_c.get("/api/v1/shifts/current"))
    assert cur["id"] == s["id"]
    assert cur["totals"]["expected_cash"] == "300.00" and cur["totals"]["orders_count"] == 0
    assert AuditEvent.objects.filter(action="shift.opened", actor=barista).count() == 1


def test_second_open_is_409(barista_c):
    barista_c.post("/api/v1/shifts/open", {"opening_cash": "0.00"}, format="json")
    r = barista_c.post("/api/v1/shifts/open", {"opening_cash": "5.00"}, format="json")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_ALREADY_OPEN"
    assert CashierShift.objects.count() == 1


@pytest.mark.parametrize("body", [{"opening_cash": "-1.00"}, {"opening_cash": 10}, {}, {"x": 1}])
def test_open_validation(barista_c, body):
    r = barista_c.post("/api/v1/shifts/open", body, format="json")
    assert r.status_code == 400 and CashierShift.objects.count() == 0


def test_each_user_has_own_shift_and_sees_only_own(org, barista_c, admin_c):
    barista_c.post("/api/v1/shifts/open", {"opening_cash": "100.00"}, format="json")
    assert data(admin_c.get("/api/v1/shifts/current")) is None
    assert (
        admin_c.post("/api/v1/shifts/open", {"opening_cash": "50.00"}, format="json").status_code
        == 201
    )
    assert data(admin_c.get("/api/v1/shifts/current"))["opening_cash"] == "50.00"
    assert data(barista_c.get("/api/v1/shifts/current"))["opening_cash"] == "100.00"


def test_db_enforces_one_open_shift_per_user(barista):
    from django.db import IntegrityError, transaction

    from apps.tenancy.models import Register

    reg = Register.objects.get(organization=barista.organization)
    kw = {
        "organization": barista.organization,
        "branch": reg.branch,
        "register": reg,
        "user": barista,
        "opening_cash": "0",
    }
    CashierShift.objects.create(**kw)
    with pytest.raises(IntegrityError), transaction.atomic():
        CashierShift.objects.create(**kw)
    CashierShift.objects.update(status="closed")  # closed shifts do not block a new one
    CashierShift.objects.create(**kw)


@pytest.mark.django_db(transaction=True)
def test_concurrent_opens_create_exactly_one(org):
    user = make_user(org, "racer", "barista")
    results = []

    def go():
        try:
            r = client_for(user).post(
                "/api/v1/shifts/open", {"opening_cash": "1.00"}, format="json"
            )
            results.append(r.status_code)
        finally:
            connection.close()

    ts = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(results) == [201, 409, 409, 409]
    assert CashierShift.objects.filter(user=user).count() == 1


def test_anonymous_gets_401(anon):
    assert anon.get("/api/v1/shifts/current").status_code == 401
    assert (
        anon.post("/api/v1/shifts/open", {"opening_cash": "1.00"}, format="json").status_code == 401
    )
