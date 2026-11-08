from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class ModifierGroup(TenantModel):
    """Model only in Sprint 1 (needed by ProductModifierGroup). Options, prices, effects and the
    API/UI arrive in Sprint 2."""

    class Mode(models.TextChoices):
        ADD = "add"
        REPLACE = "replace"

    name = models.CharField(max_length=100)
    mode = models.CharField(max_length=7, choices=Mode.choices)
    replacement_slot = models.SlugField(null=True, blank=True)  # noqa: DJ001 (spec: nullable)
    min_select = models.PositiveIntegerField(default=0)
    max_select = models.PositiveIntegerField(default=1)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_modifier_group"),
            models.CheckConstraint(
                condition=(Q(mode="replace", replacement_slot__isnull=False) | Q(mode="add")),
                name="group_slot_iff_replace_present",
            ),
            models.CheckConstraint(
                condition=Q(mode="replace") | Q(replacement_slot__isnull=True),
                name="group_slot_only_for_replace",
            ),
            models.CheckConstraint(
                condition=Q(max_select__gte=1) & Q(max_select__gte=models.F("min_select")),
                name="group_min_max_valid",
            ),
        ]


class ProductModifierGroup(TenantModel):
    product = models.ForeignKey(
        "catalog.Product", on_delete=models.PROTECT, related_name="modifier_links"
    )
    group = models.ForeignKey(ModifierGroup, on_delete=models.PROTECT, related_name="product_links")
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]
        constraints = [
            models.UniqueConstraint(fields=["product", "group"], name="uniq_product_group")
        ]
