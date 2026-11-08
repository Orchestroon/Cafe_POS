import uuid

from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import AppendOnlyModel, TenantModel


class Ingredient(TenantModel):
    class Unit(models.TextChoices):
        G = "g"
        ML = "ml"
        PCS = "pcs"

    name = models.CharField(max_length=150)
    base_unit = models.CharField(max_length=3, choices=Unit.choices)
    low_stock_threshold = models.DecimalField(
        max_digits=14, decimal_places=3, null=True, blank=True
    )
    reference_unit_cost = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_ingredient")
        ]


class StockBalance(TenantModel):
    """Changed only by inventory services under select_for_update; never by the API directly."""

    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT, related_name="balances")
    location = models.ForeignKey("tenancy.Location", on_delete=models.PROTECT, related_name="+")
    qty = models.DecimalField(max_digits=14, decimal_places=3, default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["ingredient", "location"], name="uniq_balance")
        ]


class StockAdjustment(TenantModel):
    class Kind(models.TextChoices):
        ADJUSTMENT = "adjustment"
        COUNT = "count"
        OPENING = "opening_balance"

    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT, related_name="adjustments")
    location = models.ForeignKey("tenancy.Location", on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    qty_delta = models.DecimalField(max_digits=14, decimal_places=3)
    counted_qty = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    reason = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(kind="opening_balance") | ~Q(reason=""),
                name="adjustment_reason_required",
            )
        ]


class StockMovement(AppendOnlyModel, TenantModel):
    class Type(models.TextChoices):
        OPENING = "opening_balance"
        SALE = "sale"
        PURCHASE = "purchase"
        ADJUSTMENT = "adjustment"

    class Source(models.TextChoices):
        ORDER_ITEM = "order_item"
        PURCHASE_ITEM = "purchase_item"
        STOCK_ADJUSTMENT = "stock_adjustment"

    ingredient = models.ForeignKey(Ingredient, on_delete=models.PROTECT, related_name="movements")
    location = models.ForeignKey("tenancy.Location", on_delete=models.PROTECT, related_name="+")
    qty_delta = models.DecimalField(max_digits=14, decimal_places=3)
    movement_type = models.CharField(max_length=20, choices=Type.choices)
    source_type = models.CharField(max_length=20, choices=Source.choices)
    source_id = models.UUIDField(default=uuid.uuid4)
    balance_after = models.DecimalField(max_digits=14, decimal_places=3)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    occurred_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-occurred_at", "-created_at"]
        indexes = [models.Index(fields=["ingredient", "occurred_at"])]
        constraints = [
            models.CheckConstraint(condition=~Q(qty_delta=0), name="movement_delta_not_zero"),
            models.UniqueConstraint(
                fields=["source_type", "source_id", "ingredient"], name="uniq_movement_source"
            ),
        ]
