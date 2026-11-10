from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class InvoiceCounter(TenantModel):
    """One row per organization, locked with select_for_update inside checkout (spec 8.11)."""

    last_number = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="uniq_invoice_counter")
        ]


class Order(TenantModel):
    class Status(models.TextChoices):
        PAID = "paid"
        REFUNDED = "refunded"

    branch = models.ForeignKey("tenancy.Branch", on_delete=models.PROTECT, related_name="+")
    shift = models.ForeignKey(
        "shifts.CashierShift", on_delete=models.PROTECT, related_name="orders"
    )
    cashier = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="orders")
    invoice_seq = models.PositiveIntegerField()
    invoice_no = models.CharField(max_length=40)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PAID)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    discount_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    tax_snapshot = models.JSONField()
    note = models.CharField(max_length=300, blank=True)
    idempotency_key = models.UUIDField()

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["organization", "created_at"])]
        constraints = [
            models.UniqueConstraint(fields=["organization", "invoice_no"], name="uniq_invoice_no"),
            models.UniqueConstraint(
                fields=["organization", "invoice_seq"], name="uniq_invoice_seq"
            ),
            models.UniqueConstraint(
                fields=["organization", "idempotency_key"], name="uniq_order_idem_key"
            ),
            models.CheckConstraint(
                condition=Q(subtotal__gte=0, discount_total__gte=0, tax_total__gte=0, total__gte=0),
                name="order_amounts_gte_0",
            ),
        ]


class OrderItem(TenantModel):
    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="items")
    variant = models.ForeignKey(
        "catalog.ProductVariant", on_delete=models.PROTECT, related_name="+"
    )
    quantity = models.PositiveSmallIntegerField()
    product_name_snapshot = models.CharField(max_length=150)
    variant_label_snapshot = models.CharField(max_length=50)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    unit_discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    line_discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)
    modifiers_snapshot = models.JSONField(default=list)
    recipe_snapshot = models.JSONField(default=list)
    consumption_snapshot = models.JSONField(default=list)
    promotion_snapshot = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gte=1, quantity__lte=99), name="orderitem_qty_1_99"
            )
        ]


class Payment(TenantModel):
    class Method(models.TextChoices):
        CASH = "cash"
        CARD = "card"

    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="payments")
    shift = models.ForeignKey("shifts.CashierShift", on_delete=models.PROTECT, related_name="+")
    method = models.CharField(max_length=4, choices=Method.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    cash_tendered = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    change_given = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    external_reference = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "method"], name="uniq_payment_method"),
            models.CheckConstraint(condition=Q(amount__gt=0), name="payment_amount_gt_0"),
        ]
