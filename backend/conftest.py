import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.tenancy.seed import seed_organization

PW = "Str0ng-Test-Pass!"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


def make_user(org, username, role="barista", **kw):
    return User.objects.create_user(
        username=username, password=PW, organization=org, role=role, **kw
    )


def client_for(user=None, **kw):
    c = APIClient(**kw)
    if user:
        c.force_login(user)
    return c


@pytest.fixture
def org(db):
    return seed_organization("Drip Café", "drip-cafe")


@pytest.fixture
def org2(db):
    return seed_organization("Other Café", "other-cafe")


@pytest.fixture
def admin(org):
    return make_user(org, "admin", "admin")


@pytest.fixture
def barista(org):
    return make_user(org, "barista", "barista")


@pytest.fixture
def admin2(org2):
    return make_user(org2, "admin2", "admin")


@pytest.fixture
def anon():
    return client_for()


@pytest.fixture
def admin_c(admin):
    return client_for(admin)


@pytest.fixture
def barista_c(barista):
    return client_for(barista)


@pytest.fixture
def admin2_c(admin2):
    return client_for(admin2)


def data(response):
    return response.json()["data"]
