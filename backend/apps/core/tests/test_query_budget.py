"""Sprint 4 performance sanity (spec 11): query budgets for the hot paths, and list endpoints whose
query count must not grow with the number of rows (an N+1 fails here). Budgets are today's
counts plus a small margin; raise one only with a reason."""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.sales.tests.conftest import cash, checkout, close_shift, item, open_shift
from conftest import data

pytestmark = pytest.mark.django_db

REPORTS = [
    "sales-summary",
    "payment-breakdown",
    "top-products",
    "stock",
    "purchases-expenses",
    "shifts",
]


def count(call):
    with CaptureQueriesContext(connection) as c:
        r = call()
    assert r.status_code < 300, r.content
    return len(c.captured_queries)


@pytest.fixture
def selling(shop, barista_c):
    open_shift(barista_c)
    return shop


def one(s):
    return [item(s.large, options=[s.oat, s.shot])]


def five(s):
    return [
        item(s.large, options=[s.oat, s.shot]),
        item(s.small),
        item(s.small, 2, [s.shot]),
        item(s.large),
        item(s.small, options=[s.oat]),
    ]


def quote(c, items):
    return c.post("/api/v1/orders/quote", {"items": items}, format="json")


def test_quote_is_a_fixed_number_of_queries(selling, barista_c):
    n1 = count(lambda: quote(barista_c, one(selling)))
    n5 = count(lambda: quote(barista_c, five(selling)))
    assert n1 == n5 <= 14


def test_checkout_budget(selling, barista_c):
    assert count(lambda: checkout(barista_c, one(selling), [cash("120.00")], "120.00")) <= 42
    total = data(quote(barista_c, five(selling)))["total"]
    # Inserts grow per item and per ingredient (one ledger row each); reads do not.
    assert count(lambda: checkout(barista_c, five(selling), [cash(total)], total)) <= 58


def _sell(c, s, n):
    for _ in range(n):
        assert checkout(c, one(s), [cash("120.00")], "120.00").status_code == 201


@pytest.mark.parametrize("who", ["admin", "barista"])
def test_order_list_does_not_grow_with_orders(selling, barista_c, admin_c, who):
    c = admin_c if who == "admin" else barista_c
    _sell(barista_c, selling, 1)
    small = count(lambda: c.get("/api/v1/orders"))
    _sell(barista_c, selling, 6)
    assert count(lambda: c.get("/api/v1/orders")) == small <= 10


def test_order_detail_and_receipt_budget(selling, barista_c, admin_c):
    _sell(barista_c, selling, 1)
    oid = data(admin_c.get("/api/v1/orders"))[0]["id"]
    assert count(lambda: admin_c.get(f"/api/v1/orders/{oid}")) <= 8
    assert count(lambda: barista_c.get(f"/api/v1/orders/{oid}/receipt")) <= 10


def test_products_and_modifiers_do_not_grow_with_catalog(selling, admin_c, barista_c, org):
    from apps.catalog.models import Product, ProductVariant

    before = {c: count(lambda c=c: c.get("/api/v1/products")) for c in (admin_c, barista_c)}
    groups = count(lambda: admin_c.get("/api/v1/modifier-groups"))
    for i in range(5):
        p = Product.objects.create(
            organization=org, category=selling.product.category, name=f"P{i}"
        )
        ProductVariant.objects.create(organization=org, product=p, label="S", price="10.00")
    for c, n in before.items():
        assert count(lambda c=c: c.get("/api/v1/products")) == n <= 11
    assert count(lambda: admin_c.get("/api/v1/modifier-groups")) == groups <= 12


def test_shift_endpoints_budget(selling, barista_c, admin_c):
    _sell(barista_c, selling, 3)
    assert count(lambda: barista_c.get("/api/v1/shifts/current")) <= 9
    sid = data(barista_c.get("/api/v1/shifts/current"))["id"]
    close_shift(barista_c, sid, "460.00")
    closed = count(lambda: admin_c.get("/api/v1/shifts"))
    for _ in range(4):  # more closed shifts: the list reads frozen snapshots, no extra queries
        s = open_shift(barista_c)
        close_shift(barista_c, s["id"], "100.00")
    assert count(lambda: admin_c.get("/api/v1/shifts")) == closed <= 11


def test_reports_and_audit_do_not_grow_with_sales(selling, barista_c, admin_c):
    _sell(barista_c, selling, 1)
    before = {r: count(lambda r=r: admin_c.get(f"/api/v1/reports/{r}")) for r in REPORTS}
    audit = count(lambda: admin_c.get("/api/v1/audit-events"))
    _sell(barista_c, selling, 5)
    for r, n in before.items():
        assert count(lambda r=r: admin_c.get(f"/api/v1/reports/{r}")) == n <= 11, r
    # The audit page also resolves readable names: one query per record kind, never per row.
    assert count(lambda: admin_c.get("/api/v1/audit-events")) == audit <= 24
