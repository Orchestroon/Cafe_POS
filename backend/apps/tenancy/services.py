from django.db import transaction

from apps.audit.services import record


@transaction.atomic
def update_settings(actor, settings_obj, validated):
    before = {k: str(getattr(settings_obj, k)) for k in validated}
    for k, v in validated.items():
        setattr(settings_obj, k, v)
    settings_obj.save()
    after = {k: str(getattr(settings_obj, k)) for k in validated}
    changed = {
        k: {"before": before[k], "after": after[k]} for k in validated if before[k] != after[k]
    }
    if changed:
        record(actor, "settings.updated", settings_obj, {"changes": changed})
    return settings_obj
