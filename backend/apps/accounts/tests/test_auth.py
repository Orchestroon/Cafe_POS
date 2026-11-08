import pytest
from django.core.management import call_command
from django.db import connection
from django.test import override_settings
from rest_framework.test import APIClient

from apps.audit.models import AuditEvent
from apps.catalog.models import Category
from conftest import PW, client_for, data

pytestmark = pytest.mark.django_db


def login(c, username="admin", password=PW):
    return c.post("/api/v1/auth/login", {"username": username, "password": password}, format="json")


def test_login_me_logout_flow(anon, admin):
    r = login(anon)
    assert r.status_code == 200
    body = data(r)
    assert body["user"]["username"] == "admin" and body["user"]["role"] == "admin"
    assert "password" not in str(body)
    assert body["settings"]["currency"] == "EGP" and "invoice_prefix" not in body["settings"]
    me = anon.get("/api/v1/auth/me")
    assert me.status_code == 200 and data(me)["organization"]["name"] == "Drip Café"
    assert anon.post("/api/v1/auth/logout").status_code == 204
    assert anon.get("/api/v1/auth/me").status_code == 401


def test_bad_credentials_and_unknown_user_look_the_same(anon, admin):
    a = login(anon, "admin", "wrong")
    b = login(anon, "ghost", "wrong")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()
    assert a.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_deactivated_user_cannot_login_same_error(anon, barista):
    barista.is_active = False
    barista.save()
    r = login(anon, "barista")
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_deactivated_user_existing_session_is_rejected(barista, barista_c):
    assert barista_c.get("/api/v1/auth/me").status_code == 200
    barista.is_active = False
    barista.save()
    r = barista_c.get("/api/v1/auth/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "NOT_AUTHENTICATED"
    assert barista_c.get("/api/v1/categories").status_code == 401


def test_deactivation_through_api_kills_session(admin_c, barista, barista_c):
    assert barista_c.get("/api/v1/auth/me").status_code == 200
    r = admin_c.patch(f"/api/v1/users/{barista.id}", {"is_active": False}, format="json")
    assert r.status_code == 200
    assert barista_c.get("/api/v1/auth/me").status_code == 401


def test_password_reset_invalidates_sessions_and_new_password_works(admin_c, barista, barista_c):
    assert barista_c.get("/api/v1/auth/me").status_code == 200
    r = admin_c.post(
        f"/api/v1/users/{barista.id}/reset-password",
        {"password": "Another-Str0ng-Pw!"},
        format="json",
    )
    assert r.status_code == 204
    assert barista_c.get("/api/v1/auth/me").status_code == 401
    fresh = APIClient()
    assert login(fresh, "barista", PW).status_code == 401
    assert login(fresh, "barista", "Another-Str0ng-Pw!").status_code == 200
    ev = AuditEvent.objects.get(action="user.password_reset")
    assert "Another" not in str(ev.summary)


def test_role_change_applies_to_live_session_immediately(admin_c, barista, barista_c, admin):
    assert barista_c.get("/api/v1/users").status_code == 403
    admin_c.patch(f"/api/v1/users/{barista.id}", {"role": "admin"}, format="json")
    assert barista_c.get("/api/v1/users").status_code == 200


def test_login_is_throttled_per_username_and_per_ip(anon, admin):
    for _ in range(10):
        assert login(anon, "admin", "wrong").status_code == 401
    r = login(anon, "admin", PW)  # even the right password is refused once throttled
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"


def test_login_ip_throttle_covers_many_usernames(anon, admin):
    for i in range(10):
        login(anon, f"user{i}", "x")
    assert login(anon, "another", "x").status_code == 429


def test_login_requires_csrf_token(admin):
    c = APIClient(enforce_csrf_checks=True)
    r = c.post("/api/v1/auth/login", {"username": "admin", "password": PW}, format="json")
    assert r.status_code == 403 and r.json()["error"]["code"] == "PERMISSION_DENIED"
    c.get("/api/v1/auth/csrf")
    token = c.cookies["csrftoken"].value
    r = c.post(
        "/api/v1/auth/login",
        {"username": "admin", "password": PW},
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert r.status_code == 200


def test_unsafe_authenticated_request_requires_csrf(admin):
    c = client_for(admin, enforce_csrf_checks=True)
    assert c.post("/api/v1/auth/logout").status_code == 403


def test_login_ip_throttle_ignores_forged_x_forwarded_for(anon, admin):
    for i in range(10):
        anon.post(
            "/api/v1/auth/login",
            {"username": f"user{i}", "password": "x"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.0.0.{i}",
        )
    r = anon.post(
        "/api/v1/auth/login",
        {"username": "another", "password": "x"},
        format="json",
        HTTP_X_FORWARDED_FOR="10.0.0.99",
    )
    assert r.status_code == 429


def test_login_throttle_works_on_the_database_cache(anon, admin):
    """Dev/prod use DatabaseCache (owner decision); tests default to LocMem for speed."""
    db_cache = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "django_cache",
        }
    }
    with override_settings(CACHES=db_cache):
        call_command("createcachetable", verbosity=0)  # what core migration 0002 runs
        for _ in range(10):
            assert login(anon, "admin", "wrong").status_code == 401
        assert login(anon, "admin", PW).status_code == 429
        with connection.cursor() as cur:
            cur.execute("SELECT count(*) FROM django_cache")
            assert cur.fetchone()[0] >= 2  # per-IP and per-username counters


def test_deactivated_users_live_session_cannot_write(admin, admin_c):
    admin.is_active = False
    admin.save()
    r = admin_c.post("/api/v1/categories", {"name": "Sneaky"}, format="json")
    assert r.status_code == 401 and r.json()["error"]["code"] == "NOT_AUTHENTICATED"
    assert not Category.objects.exists()


def test_self_password_reset_keeps_current_session_and_ends_others(admin, admin_c):
    other = client_for(admin)
    assert other.get("/api/v1/auth/me").status_code == 200
    r = admin_c.post(
        f"/api/v1/users/{admin.id}/reset-password", {"password": "N3w-Str0ng-Pass!"}, format="json"
    )
    assert r.status_code == 204
    assert admin_c.get("/api/v1/auth/me").status_code == 200
    assert other.get("/api/v1/auth/me").status_code == 401
