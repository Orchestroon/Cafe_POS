import pytest

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from conftest import PW, data, make_user

pytestmark = pytest.mark.django_db
NEW = {
    "username": "omar",
    "password": "Sup3r-Str0ng-Pw!",
    "role": "barista",
    "display_name": "Omar",
}


def test_create_user_audited_without_password(admin_c, org):
    r = admin_c.post("/api/v1/users", NEW, format="json")
    assert r.status_code == 201
    body = data(r)
    assert body["username"] == "omar" and "password" not in body
    u = User.objects.get(username="omar")
    assert u.organization == org and u.check_password(NEW["password"])
    ev = AuditEvent.objects.get(action="user.created")
    assert "Str0ng" not in str(ev.summary)


def test_create_user_validates(admin_c, admin):
    weak = admin_c.post("/api/v1/users", {**NEW, "password": "123"}, format="json")
    assert weak.status_code == 400
    assert weak.json()["error"]["code"] == "VALIDATION_ERROR"
    dup = admin_c.post("/api/v1/users", {**NEW, "username": "ADMIN"}, format="json")
    assert dup.status_code == 400
    bad_role = admin_c.post("/api/v1/users", {**NEW, "role": "owner"}, format="json")
    assert bad_role.status_code == 400
    assert User.objects.count() == 1


def test_list_never_exposes_hashes(admin_c, barista):
    r = admin_c.get("/api/v1/users")
    assert r.status_code == 200 and r.json()["meta"]["total_count"] == 2
    assert "pbkdf2" not in r.content.decode() and "password" not in r.content.decode()


def test_deactivate_reactivate_audited(admin_c, barista):
    url = f"/api/v1/users/{barista.id}"
    assert admin_c.patch(url, {"is_active": False}, format="json").status_code == 200
    assert admin_c.patch(url, {"is_active": True}, format="json").status_code == 200
    assert admin_c.patch(url, {"display_name": "Sam"}, format="json").status_code == 200
    actions = list(AuditEvent.objects.order_by("created_at").values_list("action", flat=True))
    assert actions == ["user.deactivated", "user.reactivated", "user.updated"]


def test_cannot_patch_unknown_or_readonly_fields(admin_c, barista):
    r = admin_c.patch(
        f"/api/v1/users/{barista.id}", {"username": "x", "password": "y"}, format="json"
    )
    assert r.status_code == 400


def test_last_admin_cannot_be_demoted_or_deactivated(org, admin, barista):
    from conftest import client_for

    other = make_user(org, "admin_b", "admin")
    c = client_for(admin)
    # two admins: demoting one is fine
    assert (
        c.patch(f"/api/v1/users/{other.id}", {"role": "barista"}, format="json").status_code == 200
    )
    # now `admin` is the last one: demoting self -> LAST_ADMIN
    r = c.patch(f"/api/v1/users/{admin.id}", {"role": "barista"}, format="json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "LAST_ADMIN"
    admin.refresh_from_db()
    assert admin.role == "admin"


def test_last_admin_cannot_be_deactivated_by_another_admin(org, admin):
    from conftest import client_for

    other = make_user(org, "admin_b", "admin")
    c_other = client_for(other)
    # admin deactivates other (ok), then other... is inactive; the remaining admin is the last.
    assert (
        client_for(admin)
        .patch(f"/api/v1/users/{other.id}", {"is_active": False}, format="json")
        .status_code
        == 200
    )
    r = client_for(admin).patch(f"/api/v1/users/{admin.id}", {"is_active": False}, format="json")
    assert r.status_code == 422  # self-deactivation is blocked first
    assert c_other.get("/api/v1/users").status_code == 401


def test_admin_cannot_deactivate_self_even_with_other_admins(org, admin, admin_c):
    make_user(org, "admin_b", "admin")
    r = admin_c.patch(f"/api/v1/users/{admin.id}", {"is_active": False}, format="json")
    assert r.status_code == 422 and r.json()["error"]["code"] == "CANNOT_DEACTIVATE_SELF"
    admin.refresh_from_db()
    assert admin.is_active


def test_reset_password_validated(admin_c, barista):
    r = admin_c.post(
        f"/api/v1/users/{barista.id}/reset-password", {"password": "short"}, format="json"
    )
    assert r.status_code == 400
    barista.refresh_from_db()
    assert barista.check_password(PW)
