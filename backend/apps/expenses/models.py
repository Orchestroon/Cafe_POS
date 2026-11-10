from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import TenantModel


class Expense(TenantModel):
    class Type(models.TextChoices):
        GENERAL = "general"
        PURCHASE = "purchase"

    class Category(models.TextChoices):
        UTILITIES = "utilities"
        RENT = "rent"
        MAINTENANCE = "maintenance"
        SUPPLIES = "supplies"
        TRANSPORT = "transport"
        CLEANING = "cleaning"
        OTHER = "other"
        PURCHASE = "purchase"

    class Method(models.TextChoices):
        CASH = "cash"
        CARD = "card"
        TRANSFER = "transfer"

    class Source(models.TextChoices):
        CASH_DRAWER = "cash_drawer"
        EXTERNAL = "external"

    class Status(models.TextChoices):
        POSTED = "posted"
        VOIDED = "voided"

    type = models.CharField(max_length=8, choices=Type.choices, default=Type.GENERAL)
    category = models.CharField(max_length=12, choices=Category.choices)
    description = models.CharField(max_length=300)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=8, choices=Method.choices)
    source = models.CharField(max_length=12, choices=Source.choices)
    shift = models.ForeignKey(
        "shifts.CashierShift", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    purchase = models.OneToOneField(
        "purchasing.Purchase",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="expense",
    )
    paid_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.POSTED)
    void_reason = models.CharField(max_length=300, blank=True)
    voided_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-paid_at", "-created_at"]
        indexes = [models.Index(fields=["organization", "paid_at"])]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="expense_amount_gt_0"),
            models.CheckConstraint(
                condition=~Q(source="cash_drawer")
                | (Q(shift__isnull=False) & Q(payment_method="cash")),
                name="expense_drawer_needs_shift_and_cash",
            ),
            models.CheckConstraint(
                condition=~Q(type="purchase") | Q(purchase__isnull=False),
                name="expense_purchase_type_has_purchase",
            ),
        ]
