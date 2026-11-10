import uuid

import pytest

from apps.audit.models import AuditEvent
from apps.expenses.models import Expense
from apps.sales.tests.conftest import cash, close_shift, open_shift, sell
from apps.shifts.models import CashierShift
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db

BODY = {"category": "supplies", "description": "Ice bags", "amount": "30.00"}


def post(c, **over):
    return c.post("/api/v1/expenses", {**BODY, **over}, format="json")


def void(c, pk, reason="entered twice"):
    return c.post(f"/api/v1/expenses/{pk}/void", {"reason": reason}, format="json")


@pytest.fixture
def shift(barista_c):
    return open_shift(barista_c, "100.00")


def test_at17_a_drawer_expense_reduces_expected_cash(barista_c, barista, shift):
    r = post(barista_c)
    assert r.status_code == 201, r.content
    d = data(r)
    assert d["source"] == "cash_drawer" and d["payment_method"] == "cash"
    assert d["shift_id"] == shift["id"] and d["status"] == "posted"
    cur = data(barista_c.get("/api/v1/shifts/current"))["totals"]
    assert cur["drawer_expenses"] == "30.00" and cur["expected_cash"] == "70.00"
    ev = AuditEvent.objects.get(action="expense.created")
    assert ev.actor == barista and ev.summary["amount"] == "30.00"


def test_a_barista_expense_is_forced_onto_their_own_shift_whatever_they_send(barista_c, shift):
    d = data(post(barista_c, source="external", payment_method="card"))
    assert (d["source"], d["payment_method"], d["shift_id"]) == ("cash_drawer", "cash", shift["id"])


def test_a_barista_without_a_shift_gets_409(barista_c):
    r = post(barista_c)
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    assert Expense.objects.count() == 0


def test_admin_external_expense_needs_no_shift(admin_c):
    d = data(post(admin_c, payment_method="transfer"))
    assert (d["source"], d["payment_method"], d["shift_id"]) == ("external", "transfer", None)


def test_admin_drawer_expense_needs_the_admins_own_open_shift(admin_c):
    r = post(admin_c, source="cash_drawer")
    assert r.status_code == 409 and r.json()["error"]["code"] == "SHIFT_NOT_OPEN"
    s = open_shift(admin_c, "0.00")
    assert data(post(admin_c, source="cash_drawer"))["shift_id"] == s["id"]


def test_admin_drawer_expense_must_be_cash(admin_c):
    open_shift(admin_c, "0.00")
    r = post(admin_c, source="cash_drawer", payment_method="card")
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "over",
    [
        {"category": "purchase"},
        {"category": "nope"},
        {"amount": "0.00"},
        {"amount": "-1.00"},
        {"amount": 5},
        {"description": ""},
        {"description": "   "},
        {"source": "bank"},
        {"surprise": 1},
    ],
)
def test_expense_validation(barista_c, shift, over):
    r = post(barista_c, **over)
    assert r.status_code == 400 and Expense.objects.count() == 0


def test_a_barista_sees_only_their_own_expenses_an_admin_all(org, barista_c, admin_c, shift):
    post(barista_c)
    other = client_for(make_user(org, "barista2", "barista"))
    open_shift(other, "0.00")
    post(other, description="Milk run")
    post(admin_c)
    assert barista_c.get("/api/v1/expenses").json()["meta"]["total_count"] == 1
    assert admin_c.get("/api/v1/expenses").json()["meta"]["total_count"] == 3
    assert admin_c.get("/api/v1/expenses?source=external").json()["meta"]["total_count"] == 1
    assert admin_c.get("/api/v1/expenses?category=other").json()["meta"]["total_count"] == 0
    assert (
        admin_c.get("/api/v1/expenses?from=2000-01-01&to=2000-01-02").json()["meta"]["total_count"]
        == 0
    )


def test_a_voided_expense_is_excluded_from_the_open_shifts_expected_cash(barista_c, admin_c, shift):
    eid = data(post(barista_c))["id"]
    assert (
        barista_c.get("/api/v1/shifts/current").json()["data"]["totals"]["expected_cash"] == "70.00"
    )
    r = void(admin_c, eid)
    assert (
        r.status_code == 200
        and data(r)["status"] == "voided"
        and data(r)["void_reason"] == "entered twice"
    )
    assert (
        barista_c.get("/api/v1/shifts/current").json()["data"]["totals"]["expected_cash"]
        == "100.00"
    )
    d = data(close_shift(barista_c, shift["id"], "100.00"))
    assert d["expected_cash"] == "100.00" and d["totals"]["drawer_expenses"] == "0.00"
    ev = AuditEvent.objects.get(action="expense.voided")
    assert ev.summary["reason"] == "entered twice"


def test_void_is_admin_only(barista_c, shift):
    eid = data(post(barista_c))["id"]
    assert void(barista_c, eid).status_code == 403
    assert Expense.objects.get().status == "posted"


def test_void_needs_a_reason(admin_c, barista_c, shift):
    eid = data(post(barista_c))["id"]
    assert void(admin_c, eid, "x").status_code == 400
    assert Expense.objects.get().status == "posted"


def test_void_twice_is_refused(admin_c, barista_c, shift):
    eid = data(post(barista_c))["id"]
    void(admin_c, eid)
    r = void(admin_c, eid)
    assert r.status_code == 422 and r.json()["error"]["code"] == "EXPENSE_NOT_VOIDABLE"
    assert AuditEvent.objects.filter(action="expense.voided").count() == 1


def test_a_closed_shifts_drawer_expense_cannot_be_voided_and_its_numbers_stay(
    barista_c, admin_c, shift
):
    eid = data(post(barista_c))["id"]
    close_shift(barista_c, shift["id"], "70.00")
    before = CashierShift.objects.values().get()
    r = void(admin_c, eid)
    assert r.status_code == 422 and r.json()["error"]["code"] == "EXPENSE_NOT_VOIDABLE"
    assert (
        Expense.objects.get().status == "posted" and CashierShift.objects.values().get() == before
    )


def test_an_external_expense_can_be_voided_any_time(admin_c):
    eid = data(post(admin_c))["id"]
    assert void(admin_c, eid).status_code == 200


def test_unknown_or_foreign_expense_is_404(admin_c, admin2_c, barista_c, shift):
    eid = data(post(barista_c))["id"]
    assert void(admin2_c, eid).status_code == 404
    assert void(admin_c, uuid.uuid4()).status_code == 404
    assert admin2_c.get("/api/v1/expenses").json()["meta"]["total_count"] == 0


def test_expense_and_sales_combine_in_expected_cash(barista_c, shop, shift):
    sell(barista_c, shop, [cash("65.00")], "65.00")
    post(barista_c, amount="12.50")
    d = data(close_shift(barista_c, shift["id"], "152.50"))
    assert d["expected_cash"] == "152.50" and d["difference"] == "0.00"


def test_admin_can_back_date_an_external_expense_not_into_the_future(admin_c):
    from datetime import timedelta

    from django.utils import timezone

    past = (timezone.now() - timedelta(days=3)).replace(microsecond=0)
    d = data(post(admin_c, paid_at=past.isoformat()))
    assert Expense.objects.get().paid_at == past and d["paid_at"].startswith(
        past.strftime("%Y-%m-%d")
    )
    future = (timezone.now() + timedelta(hours=1)).isoformat()
    r = post(admin_c, paid_at=future)
    assert r.status_code == 400 and Expense.objects.count() == 1
    assert post(admin_c, paid_at="yesterday").status_code == 400


def test_a_barista_paid_at_is_ignored(barista_c, shift):
    from datetime import timedelta

    from django.utils import timezone

    before = timezone.now()
    post(barista_c, paid_at=(before - timedelta(days=5)).isoformat())
    assert Expense.objects.get().paid_at >= before


def test_admin_drawer_expense_cannot_be_back_dated(admin_c):
    from datetime import timedelta

    from django.utils import timezone

    open_shift(admin_c, "0.00")
    r = post(
        admin_c, source="cash_drawer", paid_at=(timezone.now() - timedelta(days=1)).isoformat()
    )
    assert r.status_code == 400 and Expense.objects.count() == 0
