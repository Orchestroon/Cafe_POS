import uuid

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model

from apps.tenancy.models import Organization


def test_custom_user_model_is_configured():
    assert settings.AUTH_USER_MODEL == "accounts.User"
    assert get_user_model()._meta.label == "accounts.User"


@pytest.mark.django_db
def test_user_defaults():
    org = Organization.objects.create(name="Drip Café", slug="drip")
    u = get_user_model().objects.create_user("omar", password="x-Str0ng-pass", organization=org)
    assert isinstance(u.id, uuid.UUID)
    assert u.role == "barista" and u.preferred_language == "en" and u.is_active
