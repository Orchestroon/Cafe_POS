from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class ModifierGroup(TenantModel):
    """Reusable option group (spec D16): `replace` swaps a recipe slot, `add` adds ingredients."""

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


class ModifierOption(TenantModel):
    group = models.ForeignKey(ModifierGroup, on_delete=models.PROTECT, related_name="options")
    label = models.CharField(max_length=100)
    price_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # R2: True = the option must have an ingredient effect for the size sold. False ("No stock
    # effect", e.g. "No ice") = it deducts nothing and must keep no effects.
    track_stock = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "label"]
        constraints = [
            models.UniqueConstraint(fields=["group", "label"], name="uniq_option_label"),
            models.CheckConstraint(condition=Q(price_delta__gte=0), name="option_price_gte_0"),
        ]


class ModifierOptionPrice(TenantModel):
    """Optional per-size price override for an option (spec 7.4)."""

    option = models.ForeignKey(ModifierOption, on_delete=models.CASCADE, related_name="prices")
    variant = models.ForeignKey(
        "catalog.ProductVariant", on_delete=models.PROTECT, related_name="+"
    )
    price_delta = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["option", "variant"], name="uniq_option_price"),
            models.CheckConstraint(condition=Q(price_delta__gte=0), name="option_price_o_gte_0"),
        ]


class ModifierEffect(TenantModel):
    """Ingredient effect of an option. variant NULL = applies to all sizes (spec 7.4)."""

    option = models.ForeignKey(ModifierOption, on_delete=models.CASCADE, related_name="effects")
    variant = models.ForeignKey(
        "catalog.ProductVariant", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    ingredient = models.ForeignKey(
        "inventory.Ingredient", on_delete=models.PROTECT, related_name="+"
    )
    base_qty = models.DecimalField(max_digits=14, decimal_places=3)
    waste_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["option", "variant", "ingredient"],
                condition=Q(variant__isnull=False),
                name="uniq_effect_variant",
            ),
            models.UniqueConstraint(
                fields=["option", "ingredient"],
                condition=Q(variant__isnull=True),
                name="uniq_effect_all_sizes",
            ),
            models.CheckConstraint(condition=Q(base_qty__gte=0), name="effect_base_qty_gte_0"),
            models.CheckConstraint(
                condition=Q(waste_pct__gte=0, waste_pct__lte=100), name="effect_waste_0_100"
            ),
        ]
