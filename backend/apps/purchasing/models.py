from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class Supplier(TenantModel):
    name = models.CharField(max_length=150)
    phone = models.CharField(max_length=40, blank=True)
    notes = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="uniq_supplier")
        ]


class Purchase(TenantModel):
    class Status(models.TextChoices):
        DRAFT = "draft"
        POSTED = "posted"

    class Method(models.TextChoices):
        CASH = "cash"
        CARD = "card"
        TRANSFER = "transfer"

    class Source(models.TextChoices):
        EXTERNAL = "external"
        CASH_DRAWER = "cash_drawer"

    supplier = models.ForeignKey(
        Supplier, null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    supplier_invoice_no = models.CharField(max_length=60, blank=True)
    purchased_on = models.DateField()
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.DRAFT)
    payment_method = models.CharField(max_length=8, choices=Method.choices, default=Method.CASH)
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.EXTERNAL)
    notes = models.CharField(max_length=300, blank=True)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-purchased_on", "-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(source="cash_drawer") | Q(payment_method="cash"),
                name="purchase_drawer_is_cash",
            ),
            models.CheckConstraint(condition=Q(total__gte=0), name="purchase_total_gte_0"),
        ]


class PurchaseItem(TenantModel):
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="items")
    ingredient = models.ForeignKey(
        "inventory.Ingredient", on_delete=models.PROTECT, related_name="+"
    )
    qty = models.DecimalField(max_digits=14, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)
    # Input convenience only: qty = pack_count x pack_size (spec 7.8).
    pack_label = models.CharField(max_length=40, blank=True)
    pack_count = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    pack_size = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=Q(qty__gt=0), name="purchaseitem_qty_gt_0"),
            models.CheckConstraint(condition=Q(unit_cost__gte=0), name="purchaseitem_cost_gte_0"),
        ]
