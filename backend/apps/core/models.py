import uuid

from django.db import models


class TenantModel(models.Model):
    """Base for every tenant-owned table (spec 5.2)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "tenancy.Organization", on_delete=models.PROTECT, related_name="+", db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise RuntimeError("Append-only table: update is not allowed.")

    def delete(self):
        raise RuntimeError("Append-only table: delete is not allowed.")

    def bulk_update(self, *args, **kwargs):
        raise RuntimeError("Append-only table: update is not allowed.")


class AppendOnlyModel(models.Model):
    """History tables (StockMovement, AuditEvent): insert only (spec 5.4).

    shortcut: enforced in the ORM only; raw SQL can still modify rows. Add DB triggers or
    revoke UPDATE/DELETE from the app DB role in Sprint 5 hardening if wanted."""

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError(f"{type(self).__name__} is append-only; updates are not allowed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError(f"{type(self).__name__} is append-only; deletes are not allowed.")


class IdempotencyRecord(TenantModel):
    scope = models.CharField(max_length=100)
    key = models.UUIDField()
    request_hash = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField(default=0)
    response_body = models.JSONField(default=dict)
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "scope", "key"], name="uniq_idempotency_org_scope_key"
            )
        ]
