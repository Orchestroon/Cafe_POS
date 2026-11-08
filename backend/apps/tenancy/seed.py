from django.db import transaction

from .models import Branch, Location, Organization, OrganizationSettings, Register


@transaction.atomic
def seed_organization(name="Drip Café", slug="drip-cafe") -> Organization:
    """Idempotent: one Organization with settings, branch, default location and register."""
    org, _ = Organization.objects.get_or_create(slug=slug, defaults={"name": name})
    OrganizationSettings.objects.get_or_create(organization=org, defaults={"business_name": name})
    branch, _ = Branch.objects.get_or_create(organization=org, name="Main")
    Location.objects.get_or_create(
        organization=org, branch=branch, is_default=True, defaults={"name": "Main Stock"}
    )
    Register.objects.get_or_create(
        organization=org, branch=branch, is_default=True, defaults={"name": "Main Register"}
    )
    return org


def default_location(org) -> Location:
    return Location.objects.get(organization=org, is_default=True)
