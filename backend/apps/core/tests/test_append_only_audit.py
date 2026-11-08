import pytest

from apps.audit.models import AuditEvent
from apps.audit.services import record

pytestmark = pytest.mark.django_db


def test_record_sets_org_actor_entity(admin, org):
    ev = record(admin, "user.created", admin, {"role": "admin"})
    assert (ev.organization, ev.actor, ev.entity_type) == (org, admin, "accounts.user")
    assert ev.entity_id == admin.pk and ev.summary == {"role": "admin"}


def test_audit_rejects_secrets_even_nested(admin):
    with pytest.raises(ValueError):
        record(admin, "x", admin, {"password": "p"})
    with pytest.raises(ValueError):
        record(admin, "x", admin, {"changes": [{"sessionid": "s"}]})
    assert not AuditEvent.objects.exists()


def test_audit_is_append_only(admin):
    ev = record(admin, "a", admin)
    ev.action = "b"
    with pytest.raises(RuntimeError):
        ev.save()
    with pytest.raises(RuntimeError):
        ev.delete()
    with pytest.raises(RuntimeError):
        AuditEvent.objects.update(action="c")
    with pytest.raises(RuntimeError):
        AuditEvent.objects.all().delete()
    assert AuditEvent.objects.get().action == "a"
