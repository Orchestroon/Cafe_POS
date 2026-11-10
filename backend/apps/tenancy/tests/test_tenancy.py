import pytest
from django.db import IntegrityError, transaction

from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant
from apps.inventory.models import Ingredient, StockBalance, StockMovement
from apps.tenancy.models import Branch, Location, OrganizationSettings, Register
from apps.tenancy.seed import default_location, seed_organization
from conftest import client_for, data, make_user

pytestmark = pytest.mark.django_db


def test_seed_is_idempotent_and_complete():
    a = seed_organization()
    b = seed_organization()
    assert a == b
    assert [m.objects.count() for m in (OrganizationSettings, Branch, Location, Register)] == [
        1,
        1,
        1,
        1,
    ]
    s = OrganizationSettings.objects.get()
    assert (s.currency, s.timezone, s.receipt_paper_width, s.invoice_prefix) == (
        "EGP",
        "Africa/Cairo",
        "80mm",
        "POS-",
    )
    assert s.tax_enabled is False and s.prices_include_tax is False  # owner: tax on top
    assert Location.objects.get().is_default and Register.objects.get().is_default


def test_one_default_location_per_branch(org):
    with pytest.raises(IntegrityError), transaction.atomic():
        Location.objects.create(
            organization=org, branch=Branch.objects.get(), name="X", is_default=True
        )


def test_seed_org_command():
    from django.core.management import call_command

    call_command("seed_org")
    call_command("seed_org")
    assert OrganizationSettings.objects.count() == 1


def test_seed_demo_command_dev_only_and_idempotent(settings):
    from django.core.management import CommandError, call_command

    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_demo")
    settings.DEBUG = True
    call_command("seed_demo")
    call_command("seed_demo")
    assert Product.objects.get(name="Iced Latte").variants.count() == 3
    assert Ingredient.objects.count() == 6 and StockBalance.objects.count() == 6
    assert sorted(
        __import__("apps.accounts.models", fromlist=["User"]).User.objects.values_list(
            "username", "role"
        )
    ) == [("admin", "admin"), ("barista1", "barista"), ("barista2", "barista")]


# ---- settings endpoint
def test_settings_get_admin_full_barista_safe_subset(admin_c, barista_c):
    full = data(admin_c.get("/api/v1/settings"))
    safe = data(barista_c.get("/api/v1/settings"))
    assert "invoice_prefix" in full and "invoice_prefix" not in safe
    assert safe["currency"] == "EGP" and safe["tax_rate"] == "0.00"


def test_settings_patch_validated_and_audited(admin_c):
    r = admin_c.patch(
        "/api/v1/settings",
        {
            "business_name": "Drip",
            "receipt_paper_width": "58mm",
            "tax_enabled": True,
            "tax_rate": "14.00",
            "invoice_prefix": "INV-",
        },
        format="json",
    )
    assert r.status_code == 200 and data(r)["tax_rate"] == "14.00"
    ev = AuditEvent.objects.get(action="settings.updated")
    assert ev.summary["changes"]["tax_rate"] == {"before": "0.00", "after": "14.00"}
    assert ev.summary["changes"]["receipt_paper_width"]["after"] == "58mm"


@pytest.mark.parametrize(
    "payload",
    [
        {"tax_rate": "101.00"},
        {"tax_rate": "-1.00"},
        {"tax_rate": 14},
        {"timezone": "Mars/Base"},
        {"currency": "egp"},
        {"currency": "EGPP"},
        {"receipt_paper_width": "100mm"},
        {"invoice_prefix": " "},
        {"default_language": "fr"},
        {"unknown": 1},
    ],
)
def test_settings_patch_rejects_invalid(admin_c, payload):
    assert admin_c.patch("/api/v1/settings", payload, format="json").status_code == 400
    assert not AuditEvent.objects.exists()


def test_settings_noop_patch_not_audited(admin_c):
    admin_c.patch("/api/v1/settings", {"currency": "EGP"}, format="json")
    assert not AuditEvent.objects.exists()


# ---- tenancy isolation: two organizations
@pytest.fixture
def two_orgs(org, org2, admin, admin2):
    """Each org gets one of everything; returns {org: ids}."""
    out = {}
    for o, a in ((org, admin), (org2, admin2)):
        c = client_for(a)
        cat = data(c.post("/api/v1/categories", {"name": "Cat"}, format="json"))
        prod = data(
            c.post("/api/v1/products", {"category_id": cat["id"], "name": "Prod"}, format="json")
        )
        var = data(
            c.post(
                f"/api/v1/products/{prod['id']}/variants",
                {"label": "S", "price": "1.00"},
                format="json",
            )
        )
        ing = data(c.post("/api/v1/ingredients", {"name": "Ing", "base_unit": "g"}, format="json"))
        c.post(
            "/api/v1/inventory/adjustments",
            {"ingredient_id": ing["id"], "mode": "delta", "qty_delta": "5.000", "reason": "x"},
            format="json",
        )
        u = make_user(o, f"extra-{o.slug}", "barista")
        out[o.slug] = {
            "cat": cat["id"],
            "prod": prod["id"],
            "var": var["id"],
            "ing": ing["id"],
            "user": str(u.id),
        }
    return out


LISTS = [
    "users",
    "categories",
    "products",
    "ingredients",
    "inventory/balances",
    "inventory/movements",
]


@pytest.mark.parametrize("path", LISTS)
def test_lists_never_leak_across_orgs(path, two_orgs, admin_c, admin2_c):
    a = admin_c.get(f"/api/v1/{path}").json()
    b = admin2_c.get(f"/api/v1/{path}").json()
    ids_a = {str(x.get("id") or x.get("ingredient_id")) for x in a["data"]}
    ids_b = {str(x.get("id") or x.get("ingredient_id")) for x in b["data"]}
    assert ids_a and ids_b and not (ids_a & ids_b)


def test_detail_and_mutations_on_other_org_objects_are_404(two_orgs, admin_c):
    o = two_orgs["other-cafe"]
    for method, url, body in [
        ("get", f"categories/{o['cat']}", None),
        ("patch", f"categories/{o['cat']}", {"name": "x"}),
        ("get", f"products/{o['prod']}", None),
        ("patch", f"products/{o['prod']}", {"name": "x"}),
        ("post", f"products/{o['prod']}/variants", {"label": "L", "price": "2.00"}),
        ("put", f"products/{o['prod']}/modifier-groups", []),
        ("patch", f"variants/{o['var']}", {"price": "9.00"}),
        ("get", f"ingredients/{o['ing']}", None),
        ("patch", f"ingredients/{o['ing']}", {"name": "x"}),
        ("patch", f"users/{o['user']}", {"is_active": False}),
        ("post", f"users/{o['user']}/reset-password", {"password": "Sup3r-Str0ng-Pw!"}),
    ]:
        r = getattr(admin_c, method)(f"/api/v1/{url}", body, format="json")
        assert r.status_code == 404, (method, url, r.status_code)
    assert ProductVariant.objects.get(pk=o["var"]).price == 1
    assert make_user  # other org untouched
    r = admin_c.post(
        "/api/v1/inventory/adjustments",
        {"ingredient_id": o["ing"], "mode": "delta", "qty_delta": "1.000", "reason": "x"},
        format="json",
    )
    assert r.status_code == 404
    r = admin_c.post(
        "/api/v1/inventory/opening-balances",
        {"items": [{"ingredient_id": o["ing"], "qty": "1.000"}]},
        format="json",
    )
    assert r.status_code == 400
    assert StockMovement.objects.filter(organization__slug="other-cafe").count() == 1


def test_cross_org_references_rejected(two_orgs, admin_c):
    o = two_orgs["other-cafe"]
    assert (
        admin_c.post(
            "/api/v1/products", {"category_id": o["cat"], "name": "Z"}, format="json"
        ).status_code
        == 400
    )


def test_same_names_allowed_in_different_orgs(two_orgs):
    assert (
        Category.objects.filter(name="Cat").count() == 2
        and Product.objects.filter(name="Prod").count() == 2
    )


def test_settings_and_audit_are_per_org(two_orgs, admin_c, admin2_c):
    admin_c.patch("/api/v1/settings", {"business_name": "A Café"}, format="json")
    assert data(admin2_c.get("/api/v1/settings"))["business_name"] == "Other Café"
    assert (
        AuditEvent.objects.filter(
            action="settings.updated", organization__slug="other-cafe"
        ).count()
        == 0
    )


def test_default_location_is_per_org(org, org2):
    assert default_location(org) != default_location(org2)


@pytest.mark.parametrize("width", ["58mm", "76mm", "80mm", "112mm", "a4"])
def test_all_market_paper_widths_accepted(admin_c, width):
    r = admin_c.patch("/api/v1/settings", {"receipt_paper_width": width}, format="json")
    assert r.status_code == 200 and data(r)["receipt_paper_width"] == width


def test_tax_migration_sets_on_top_only_while_tax_disabled(org, org2):
    import importlib

    from django.apps import apps as django_apps

    from apps.tenancy.models import OrganizationSettings

    mig = importlib.import_module("apps.tenancy.migrations.0003_paper_widths_tax_on_top")
    OrganizationSettings.objects.filter(organization=org).update(
        tax_enabled=False, prices_include_tax=True
    )
    OrganizationSettings.objects.filter(organization=org2).update(
        tax_enabled=True, prices_include_tax=True
    )
    mig.tax_on_top_while_disabled(django_apps, None)
    assert OrganizationSettings.objects.get(organization=org).prices_include_tax is False
    assert OrganizationSettings.objects.get(organization=org2).prices_include_tax is True
