from .models import AuditEvent

_FORBIDDEN = {"password", "new_password", "token", "csrf", "csrftoken", "sessionid", "secret"}


def _check(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() in _FORBIDDEN:
                raise ValueError(f"Audit summary must not contain '{k}'.")
            _check(v)
    elif isinstance(obj, list | tuple):
        for v in obj:
            _check(v)


def record(actor, action, entity, summary=None, organization=None) -> AuditEvent:
    """Call explicitly from services, inside the same transaction as the change (spec 5.6)."""
    summary = summary or {}
    _check(summary)
    return AuditEvent.objects.create(
        organization=organization or actor.organization,
        actor=actor,
        action=action,
        entity_type=entity._meta.label_lower,
        entity_id=entity.pk,
        summary=summary,
    )
