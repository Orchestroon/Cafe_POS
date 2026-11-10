"""Every route is listed here (a guard test fails if a new route is not). For each one:
anonymous -> 401, barista on admin-only -> 403 with no side effects, shared -> allowed."""

import re

import pytest
from django.urls import get_resolver

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant, RecipeLine
from apps.core.models import IdempotencyRecord
from apps.expenses.models import Expense
from apps.inventory.models import Ingredient, StockAdjustment, StockBalance, StockMovement
from apps.modifiers.models import (
    ModifierEffect,
    ModifierGroup,
    ModifierOption,
    ModifierOptionPrice,
)
from apps.purchasing.models import Purchase, PurchaseItem, Supplier
from apps.sales.models import Order, Payment, Refund, RefundLine
from apps.shifts.models import CashierShift

pytestmark = pytest.mark.django_db

ADMIN, BOTH, PUBLIC = "admin", "both", "public"
Z = "00000000-0000-0000-0000-000000000000"

# (method, route template, access). Placeholders: {user} {category} {product} {variant}
# {ingredient} {group} {option} {order}
MATRIX = [
    ("GET", "health", PUBLIC),
    ("GET", "auth/csrf", PUBLIC),
    ("POST", "auth/login", PUBLIC),
    ("POST", "auth/logout", BOTH),
    ("GET", "auth/me", BOTH),
    ("GET", "settings", BOTH),
    ("PATCH", "settings", ADMIN),
    ("GET", "users", ADMIN),
    ("POST", "users", ADMIN),
    ("PATCH", "users/{user}", ADMIN),
    ("POST", "users/{user}/reset-password", ADMIN),
    ("GET", "categories", BOTH),
    ("POST", "categories", ADMIN),
    ("GET", "categories/{category}", BOTH),
    ("PATCH", "categories/{category}", ADMIN),
    ("GET", "products", BOTH),
    ("POST", "products", ADMIN),
    ("GET", "products/{product}", BOTH),
    ("PATCH", "products/{product}", ADMIN),
    ("POST", "products/{product}/variants", ADMIN),
    ("PUT", "products/{product}/modifier-groups", ADMIN),
    ("PATCH", "variants/{variant}", ADMIN),
    ("GET", "variants/{variant}/recipe", ADMIN),
    ("PUT", "variants/{variant}/recipe", ADMIN),
    ("GET", "modifier-groups", BOTH),
    ("POST", "modifier-groups", ADMIN),
    ("GET", "modifier-groups/{group}", BOTH),
    ("PATCH", "modifier-groups/{group}", ADMIN),
    ("POST", "modifier-groups/{group}/options", ADMIN),
    ("PATCH", "modifier-options/{option}", ADMIN),
    ("GET", "orders", BOTH),
    ("GET", "orders/{order}", BOTH),
    ("GET", "orders/{order}/receipt", BOTH),
    ("POST", "orders/quote", BOTH),
    ("POST", "orders/checkout", BOTH),
    ("GET", "shifts/current", BOTH),
    ("POST", "shifts/open", BOTH),
    ("GET", "shifts", ADMIN),
    ("GET", "shifts/{shift}", BOTH),
    ("POST", "shifts/{shift}/close", BOTH),
    ("POST", "orders/{order}/refunds", BOTH),
    ("GET", "refunds", ADMIN),
    ("GET", "payments", ADMIN),
    ("GET", "suppliers", ADMIN),
    ("POST", "suppliers", ADMIN),
    ("PATCH", "suppliers/{supplier}", ADMIN),
    ("GET", "purchases", ADMIN),
    ("POST", "purchases", ADMIN),
    ("GET", "purchases/{purchase}", ADMIN),
    ("PATCH", "purchases/{purchase}", ADMIN),
    ("DELETE", "purchases/{purchase}", ADMIN),
    ("POST", "purchases/{purchase}/post", ADMIN),
    ("GET", "expenses", BOTH),
    ("POST", "expenses", BOTH),
    ("POST", "expenses/{expense}/void", ADMIN),
    ("GET", "reports/sales-summary", ADMIN),
    ("GET", "reports/payment-breakdown", ADMIN),
    ("GET", "reports/top-products", ADMIN),
    ("GET", "reports/stock", ADMIN),
    ("GET", "reports/purchases-expenses", ADMIN),
    ("GET", "reports/shifts", ADMIN),
    ("GET", "ingredients", ADMIN),
    ("POST", "ingredients", ADMIN),
    ("GET", "ingredients/{ingredient}", ADMIN),
    ("PATCH", "ingredients/{ingredient}", ADMIN),
    ("GET", "inventory/balances", ADMIN),
    ("GET", "inventory/movements", ADMIN),
    ("POST", "inventory/adjustments", ADMIN),
    ("POST", "inventory/opening-balances", ADMIN),
]


@pytest.fixture
def ids(org, admin, barista):
    cat = Category.objects.create(organization=org, name="C")
    prod = Product.objects.create(organization=org, category=cat, name="P")
    var = ProductVariant.objects.create(organization=org, product=prod, label="S", price="1.00")
    ing = Ingredient.objects.create(organization=org, name="I", base_unit="g")
    from apps.tenancy.seed import default_location

    StockBalance.objects.create(organization=org, ingredient=ing, location=default_location(org))
    grp = ModifierGroup.objects.create(organization=org, name="G", mode="add", max_select=2)
    opt = ModifierOption.objects.create(organization=org, group=grp, label="O", price_delta="1.00")
    from apps.tenancy.models import Register

    reg = Register.objects.get(organization=org)
    shift = CashierShift.objects.create(
        organization=org, branch=reg.branch, register=reg, user=barista, opening_cash="0.00"
    )
    order = Order.objects.create(
        organization=org,
        branch=reg.branch,
        shift=shift,
        cashier=barista,
        invoice_seq=1,
        invoice_no="POS-0000001",
        subtotal="1.00",
        total="1.00",
        tax_snapshot={"enabled": False, "rate": "0.00", "inclusive": False, "label": "VAT"},
        idempotency_key="11111111-1111-1111-1111-111111111111",
    )
    supplier = Supplier.objects.create(organization=org, name="Dairy Co")
    purchase = Purchase.objects.create(
        organization=org, purchased_on="2026-11-10", created_by=admin, total="0.00"
    )
    expense = Expense.objects.create(
        organization=org,
        category="supplies",
        description="Ice",
        amount="5.00",
        payment_method="cash",
        source="cash_drawer",
        shift=shift,
        created_by=barista,
    )
    return {
        "supplier": supplier.id,
        "purchase": purchase.id,
        "expense": expense.id,
        "shift": shift.id,
        "order": order.id,
        "group": grp.id,
        "option": opt.id,
        "user": barista.id,
        "category": cat.id,
        "product": prod.id,
        "variant": var.id,
        "ingredient": ing.id,
    }


def url(route, ids):
    return "/api/v1/" + route.format(**ids)


def snapshot():
    return {
        m.__name__: m.objects.count()
        for m in (
            User,
            AuditEvent,
            Category,
            Product,
            ProductVariant,
            RecipeLine,
            CashierShift,
            Order,
            Payment,
            ModifierGroup,
            ModifierOption,
            ModifierOptionPrice,
            ModifierEffect,
            Ingredient,
            StockMovement,
            StockAdjustment,
            IdempotencyRecord,
            Refund,
            RefundLine,
            Supplier,
            Purchase,
            PurchaseItem,
            Expense,
        )
    }


def call(c, method, u):
    return getattr(c, method.lower())(u, {}, format="json")


def test_matrix_covers_every_route():
    found = set()

    def walk(patterns, prefix):
        for p in patterns:
            s = prefix + str(p.pattern)
            if hasattr(p, "url_patterns"):
                walk(p.url_patterns, s)
            else:
                found.add(s)

    walk(get_resolver().url_patterns, "")
    routes = set()
    for s in found:
        s = re.sub(r"\(\?P<\w+>\[\^/\.\]\+\)", "{id}", s)
        routes.add(s.replace("^", "").replace("$", "").removeprefix("api/v1/").rstrip("/"))
    listed = {re.sub(r"\{\w+\}", "{id}", r) for _, r, _ in MATRIX}
    assert routes == listed, f"unlisted: {routes - listed}; stale: {listed - routes}"


@pytest.mark.parametrize(
    ("method", "route", "access"), [m for m in MATRIX if m[2] in (ADMIN, BOTH)]
)
def test_anonymous_gets_401_and_nothing_changes(method, route, access, ids, anon):
    before = snapshot()
    r = call(anon, method, url(route, ids))
    assert r.status_code == 401, r.content
    assert r.json()["error"]["code"] == "NOT_AUTHENTICATED"
    assert snapshot() == before


@pytest.mark.parametrize(("method", "route", "access"), [m for m in MATRIX if m[2] == ADMIN])
def test_barista_gets_403_and_nothing_changes(method, route, access, ids, barista_c):
    before = snapshot()
    r = call(barista_c, method, url(route, ids))
    assert r.status_code == 403, r.content
    assert r.json()["error"]["code"] == "PERMISSION_DENIED"
    assert snapshot() == before


@pytest.mark.parametrize(
    ("method", "route", "access"), [m for m in MATRIX if m[2] == BOTH and m[0] == "GET"]
)
def test_shared_reads_allowed_for_barista_and_admin(method, route, access, ids, barista_c, admin_c):
    for c in (barista_c, admin_c):
        assert call(c, method, url(route, ids)).status_code == 200


@pytest.mark.parametrize(
    ("method", "route", "access"), [m for m in MATRIX if m[2] == ADMIN and m[0] == "GET"]
)
def test_admin_reads_work(method, route, access, ids, admin_c):
    assert call(admin_c, method, url(route, ids)).status_code == 200


def test_public_endpoints_need_no_session(anon):
    assert anon.get("/api/v1/health").status_code == 200
    assert anon.get("/api/v1/auth/csrf").status_code == 200
    assert anon.post("/api/v1/auth/login", {}, format="json").status_code == 400


def test_inactive_admin_is_not_authorized(ids, admin, admin_c):
    admin.is_active = False
    admin.save()
    assert admin_c.get("/api/v1/users").status_code == 401
