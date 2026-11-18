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
        VOIDED = "voided"

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
    # Sprint 5 P4: bought on credit. Posting adds the stock and its cost but no money goes out;
    # supplier payments pay it off (amount_paid), each one an expense on the day it is paid.
    on_credit = models.BooleanField(default=False)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    void_reason = models.CharField(max_length=300, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        ordering = ["-purchased_on", "-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(source="cash_drawer") | Q(payment_method="cash"),
                name="purchase_drawer_is_cash",
            ),
            models.CheckConstraint(condition=Q(total__gte=0), name="purchase_total_gte_0"),
            models.CheckConstraint(
                condition=Q(amount_paid__gte=0, amount_paid__lte=models.F("total")),
                name="purchase_paid_within_total",
            ),
            models.CheckConstraint(
                condition=Q(on_credit=True) | Q(amount_paid=0), name="purchase_paid_only_credit"
            ),
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
    # The price of one pack as typed; when set, line_total = pack_count x pack_cost exactly.
    pack_cost = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=Q(qty__gt=0), name="purchaseitem_qty_gt_0"),
            models.CheckConstraint(condition=Q(unit_cost__gte=0), name="purchaseitem_cost_gte_0"),
        ]


class SupplierPayment(TenantModel):
    """Money paid to a supplier for purchases bought on credit (Sprint 5 P4). It pays one or
    more of that supplier's credit purchases (its lines) and is recorded as one expense on the
    day it is paid (from the drawer: the payer's open shift). Voided, never deleted."""

    class Status(models.TextChoices):
        POSTED = "posted"
        VOIDED = "voided"

    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    source = models.CharField(max_length=12, choices=Purchase.Source.choices)
    payment_method = models.CharField(max_length=8, choices=Purchase.Method.choices)
    shift = models.ForeignKey(
        "shifts.CashierShift", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    note = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=6, choices=Status.choices, default=Status.POSTED)
    void_reason = models.CharField(max_length=300, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="supplierpayment_amount_gt_0"),
            models.CheckConstraint(
                condition=~Q(source="cash_drawer")
                | (Q(shift__isnull=False) & Q(payment_method="cash")),
                name="supplierpayment_drawer_needs_shift_and_cash",
            ),
        ]


class SupplierPaymentLine(TenantModel):
    payment = models.ForeignKey(SupplierPayment, on_delete=models.PROTECT, related_name="lines")
    purchase = models.ForeignKey(Purchase, on_delete=models.PROTECT, related_name="payment_lines")
    amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=Q(amount__gt=0), name="paymentline_amount_gt_0"),
            models.UniqueConstraint(fields=["payment", "purchase"], name="uniq_payment_purchase"),
        ]
