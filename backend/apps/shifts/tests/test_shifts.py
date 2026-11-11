import threading

import pytest
from django.db import connection

from apps.audit.models import AuditEvent
from apps.shifts.models import CashierShift
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db


def test_current_is_null_before_opening(barista_c):
    r = barista_c.get("/api/v1/shifts/current")
    assert r.status_code == 200 and r.json() == {"data": None, "meta": {"last_closed": None}}


def test_c2_current_shows_own_last_close_only_when_no_shift_is_open(barista_c, admin_c, org):
    """C2 (owner, 2026-11-11): information only; another user's close is never shown."""
    for who, amount in [(barista_c, "100.00"), (barista_c, "250.00"), (admin_c, "999.00")]:
        sid = data(who.post("/api/v1/shifts/open", {"opening_cash": "10.00"}, format="json"))["id"]
        r = who.post(f"/api/v1/shifts/{sid}/close", {"actual_closing_cash": amount}, format="json")
        assert r.status_code == 200, r.content
    meta = barista_c.get("/api/v1/shifts/current").json()["meta"]
    assert meta["last_closed"]["actual_cash"] == "250.00" and meta["last_closed"]["closed_at"]
    barista_c.post("/api/v1/shifts/open", {"opening_cash": "250.00"}, format="json")
    assert barista_c.get("/api/v1/shifts/current").json()["meta"] == {}


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


@pytest.mark.parametrize("extra_branches", [0, 1])
def test_open_without_exactly_one_default_register_is_422_not_500(org, barista_c, extra_branches):
    """No default register, or one per branch on a second branch: a clean 422, no shift."""
    from apps.tenancy.models import Branch, Register

    if extra_branches:
        b2 = Branch.objects.create(organization=org, name="Second")
        Register.objects.create(organization=org, branch=b2, name="R2", is_default=True)
    else:
        Register.objects.filter(organization=org).update(is_default=False)
    r = barista_c.post("/api/v1/shifts/open", {"opening_cash": "0.00"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "REGISTER_NOT_CONFIGURED"
    assert CashierShift.objects.count() == 0
