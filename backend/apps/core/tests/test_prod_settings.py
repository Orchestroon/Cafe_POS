"""Production settings (Sprint 6): `check --deploy` is clean, a weak configuration refuses to
start, and the dev-only surface (API docs) is not served. Each check runs in its own process
because settings are read once at start-up."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[3]
GOOD = {
    "DJANGO_SETTINGS_MODULE": "config.settings.prod",
    "SECRET_KEY": "k9Zx-Qm4vT7pLw2RsB8dYhN3cFjU6aGeXo1iVtMz5KqPnWy0rEbHsLdCu_AfJgTx",
    "ALLOWED_HOSTS": "pos.example.com",
    "CSRF_TRUSTED_ORIGINS": "https://pos.example.com",
    # the test database, so /health can answer for real
    "DATABASE_URL": os.environ.get("DATABASE_URL", "postgres://u:p@localhost:5432/x"),
}


def run(args, **env):
    base = {k: v for k, v in os.environ.items() if k not in GOOD}
    return subprocess.run(
        [sys.executable, *args],
        cwd=BACKEND,
        env={**base, **GOOD, **env},
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_check_deploy_has_no_warnings():
    r = run(["manage.py", "check", "--deploy", "--fail-level", "WARNING"])
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize(
    "env",
    [
        {"SECRET_KEY": "short"},
        {"SECRET_KEY": "django-insecure-" + "x1y2z3" * 12},
        {"SECRET_KEY": "dev-only-insecure-key" + "abcdefghij" * 4},
        {"ALLOWED_HOSTS": ""},
        {"ALLOWED_HOSTS": "*"},
        {"CSRF_TRUSTED_ORIGINS": ""},
        {"CSRF_TRUSTED_ORIGINS": "http://pos.example.com"},
    ],
)
def test_a_weak_configuration_refuses_to_start(env):
    r = run(["manage.py", "check"], **env)
    assert r.returncode != 0 and "ImproperlyConfigured" in r.stderr


def test_docs_and_schema_are_not_served_and_health_exposes_only_status():
    script = (
        "import django, json; django.setup()\n"
        "from django.test import Client\n"
        "c = Client(HTTP_HOST='pos.example.com')\n"
        "paths = ('/api/v1/docs/', '/api/v1/schema/')\n"
        "out = {p: c.get(p, secure=True).status_code for p in paths}\n"
        "h = c.get('/api/v1/health', secure=True)\n"
        "out['health'] = h.status_code; out['keys'] = sorted(h.json()['data'])\n"
        "out['plain'] = c.get('/api/v1/health').status_code\n"  # healthcheck needs no https
        "out['redirect'] = c.get('/api/v1/auth/me').status_code\n"
        "print(json.dumps(out))\n"
    )
    r = run(["-c", script])
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["/api/v1/docs/"] == out["/api/v1/schema/"] == 404
    assert out["health"] == 200 and out["plain"] == 200 and out["redirect"] == 301
    assert set(out["keys"]) <= {"status", "db"}
