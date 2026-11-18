"""Promotions (spec 7.9, 8.12). Rules only: how a discount is chosen and applied lives in the pure
engine `apps/sales/promotions.py`, and what was applied is snapshotted on the order."""

from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class Promotion(TenantModel):
    class Kind(models.TextChoices):
        DISCOUNT = "discount"
        COMBO = "combo"

    class Scope(models.TextChoices):
        VARIANT = "variant"  # specific sizes
        CATEGORY = "category"
        ORDER = "order"  # the whole order, extras included

    class DiscountType(models.TextChoices):
        PERCENTAGE = "percentage"
        FIXED = "fixed_amount"

    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=8, choices=Kind.choices)
    is_active = models.BooleanField(default=True)
    # True: applied by itself when it fits. False: the cashier taps it on the POS (coupon-like).
    auto_apply = models.BooleanField(default=True)

    # Kind "discount"
    scope = models.CharField(max_length=8, choices=Scope.choices, blank=True)
    discount_type = models.CharField(max_length=12, choices=DiscountType.choices, blank=True)
    discount_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    variants = models.ManyToManyField("catalog.ProductVariant", blank=True, related_name="+")
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="+")

    # Kind "combo": the bundle's fixed price for the base prices of the slots' sizes
    combo_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # Schedule, in the café's timezone. Empty = always.
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)  # inclusive
    days_of_week = models.JSONField(default=list, blank=True)  # 0 = Monday ... 6 = Sunday
    window_start = models.TimeField(null=True, blank=True)  # Happy Hour; may pass midnight
    window_end = models.TimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_promotion_name"),
            models.CheckConstraint(
                condition=Q(ends_on__isnull=True)
                | Q(starts_on__isnull=True)
                | Q(ends_on__gte=models.F("starts_on")),
                name="promotion_dates_ordered",
            ),
            models.CheckConstraint(
                condition=Q(window_start__isnull=True, window_end__isnull=True)
                | Q(window_start__isnull=False, window_end__isnull=False),
                name="promotion_window_both",
            ),
            models.CheckConstraint(
                condition=(
                    Q(kind="combo", combo_price__gte=0, scope="", discount_type="")
                    & Q(discount_value__isnull=True)
                )
                | (
                    Q(kind="discount", combo_price__isnull=True, discount_value__gt=0)
                    & ~Q(scope="")
                    & ~Q(discount_type="")
                ),
                name="promotion_kind_fields",
            ),
            models.CheckConstraint(
                condition=~Q(discount_type="percentage") | Q(discount_value__lte=100),
                name="promotion_pct_max_100",
            ),
        ]


class ComboSlot(TenantModel):
    """One part of a combo: `quantity` units of any size in `variants` or of the `category`."""

    promotion = models.ForeignKey(Promotion, on_delete=models.CASCADE, related_name="slots")
    quantity = models.PositiveSmallIntegerField(default=1)
    category = models.ForeignKey(
        "catalog.Category", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    variants = models.ManyToManyField("catalog.ProductVariant", blank=True, related_name="+")
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gte=1, quantity__lte=20), name="comboslot_qty_1_20"
            )
        ]
