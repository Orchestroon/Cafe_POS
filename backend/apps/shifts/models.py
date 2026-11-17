from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import TenantModel


class CashierShift(TenantModel):
    """One shift per user (D7). Close fields are filled by the close service (Sprint 3)."""

    class Status(models.TextChoices):
        OPEN = "open"
        CLOSED = "closed"

    branch = models.ForeignKey("tenancy.Branch", on_delete=models.PROTECT, related_name="+")
    register = models.ForeignKey("tenancy.Register", on_delete=models.PROTECT, related_name="+")
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="shifts")
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.OPEN)
    opening_cash = models.DecimalField(max_digits=12, decimal_places=2)
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    actual_cash = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    difference = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    close_note = models.CharField(max_length=300, blank=True)
    totals_snapshot = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-opened_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"], condition=Q(status="open"), name="uniq_open_shift_per_user"
            ),
            models.CheckConstraint(condition=Q(opening_cash__gte=0), name="shift_opening_gte_0"),
        ]


class CashMovement(TenantModel):
    """Cash put into or taken out of a shift's drawer that is not a sale, refund or expense, e.g.
    cash to the safe or change from the owner (owner, 2026-11-16). It moves cash only: it changes
    expected cash but is never an expense and never touches profit."""

    class Kind(models.TextChoices):
        IN = "in"
        OUT = "out"

    class Status(models.TextChoices):
        POSTED = "posted"
        VOIDED = "voided"

    shift = models.ForeignKey(CashierShift, on_delete=models.PROTECT, related_name="cash_movements")
    kind = models.CharField(max_length=3, choices=Kind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=300)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.POSTED)
    void_reason = models.CharField(max_length=300, blank=True)
    voided_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    idempotency_key = models.UUIDField()

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["organization", "created_at"])]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="cashmove_amount_gt_0"),
            models.CheckConstraint(condition=~Q(reason=""), name="cashmove_reason_required"),
            models.UniqueConstraint(
                fields=["organization", "idempotency_key"], name="uniq_cashmove_idem_key"
            ),
        ]
