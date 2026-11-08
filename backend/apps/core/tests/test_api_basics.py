import pytest
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory

from apps.core.exceptions import ApiError


@pytest.mark.django_db
def test_health_ok_without_auth_and_envelope(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"data": {"status": "ok", "db": "ok"}, "meta": {}}


def test_unknown_url_returns_json_error_envelope(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


@api_view(["GET"])
def _protected(request):
    return Response({"x": 1})


@api_view(["GET"])
@permission_classes([AllowAny])
def _domain_error(request):
    raise ApiError("LAST_ADMIN", "Cannot remove the last admin.", 422)


def test_anonymous_gets_401_envelope_not_403():
    r = _protected(APIRequestFactory().get("/"))
    r.render()
    assert r.status_code == 401
    assert r.data["error"]["code"] == "NOT_AUTHENTICATED"


def test_domain_error_envelope():
    r = _domain_error(APIRequestFactory().get("/"))
    r.render()
    assert r.status_code == 422
    assert r.data["error"] == {
        "code": "LAST_ADMIN",
        "message": "Cannot remove the last admin.",
        "details": {},
    }
