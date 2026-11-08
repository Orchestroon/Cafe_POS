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
