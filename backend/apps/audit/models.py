from django.db import models

from apps.core.models import AppendOnlyModel, TenantModel


class AuditEvent(AppendOnlyModel, TenantModel):
    actor = models.ForeignKey(
        "accounts.User", null=True, on_delete=models.PROTECT, related_name="+"
    )
    action = models.CharField(max_length=60)
    entity_type = models.CharField(max_length=60)
    entity_id = models.UUIDField()
    summary = models.JSONField(default=dict)

    class Meta:
        indexes = [
            models.Index(fields=["organization", "created_at"]),
            models.Index(fields=["entity_type", "entity_id"]),
        ]
