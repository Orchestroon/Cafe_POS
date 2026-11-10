from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class Category(TenantModel):
    name = models.CharField(max_length=100)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_category")
        ]
        ordering = ["sort_order", "name"]


class Product(TenantModel):
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_product")
        ]
        ordering = ["sort_order", "name"]


class ProductVariant(TenantModel):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="variants")
    label = models.CharField(max_length=50)
    sku = models.CharField(max_length=50, null=True, blank=True)  # noqa: DJ001 (spec: nullable unique)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "price"]
        constraints = [
            models.UniqueConstraint(fields=["product", "label"], name="uniq_variant_label"),
            models.UniqueConstraint(
                fields=["organization", "sku"],
                condition=Q(sku__isnull=False),
                name="uniq_variant_sku",
            ),
            models.CheckConstraint(condition=Q(price__gte=0), name="variant_price_gte_0"),
        ]


class RecipeLine(TenantModel):
    """Replaced wholesale per variant (PUT). CASCADE is acceptable only because history lives in
    order snapshots (spec 7.3)."""

    variant = models.ForeignKey(
        ProductVariant, on_delete=models.CASCADE, related_name="recipe_lines"
    )
    ingredient = models.ForeignKey(
        "inventory.Ingredient", on_delete=models.PROTECT, related_name="recipe_lines"
    )
    base_qty = models.DecimalField(max_digits=14, decimal_places=3)
    waste_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    slot_key = models.SlugField(max_length=50, null=True, blank=True)  # noqa: DJ001 (spec: nullable)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["variant", "ingredient"], name="uniq_recipe_ingredient"
            ),
            models.UniqueConstraint(
                fields=["variant", "slot_key"],
                condition=Q(slot_key__isnull=False),
                name="uniq_recipe_slot",
            ),
            models.CheckConstraint(condition=Q(base_qty__gte=0), name="recipe_base_qty_gte_0"),
            models.CheckConstraint(
                condition=Q(waste_pct__gte=0, waste_pct__lte=100), name="recipe_waste_0_100"
            ),
        ]
