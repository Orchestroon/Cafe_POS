import uuid

from django.db import models
from django.db.models import Q

from apps.core.models import TenantModel


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class OrganizationSettings(TenantModel):
    class PaperWidth(models.TextChoices):
        MM58 = "58mm"
        MM76 = "76mm"
        MM80 = "80mm"
        MM112 = "112mm"
        A4 = "a4"

    currency = models.CharField(max_length=3, default="EGP")
    timezone = models.CharField(max_length=64, default="Africa/Cairo")
    default_language = models.CharField(max_length=2, default="en")
    business_name = models.CharField(max_length=200, blank=True)
    receipt_header = models.TextField(blank=True)
    receipt_footer = models.TextField(blank=True)
    receipt_paper_width = models.CharField(
        max_length=5, choices=PaperWidth.choices, default=PaperWidth.MM80
    )
    invoice_prefix = models.CharField(max_length=20, default="POS-")
    tax_enabled = models.BooleanField(default=False)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    prices_include_tax = models.BooleanField(default=False)  # owner: tax added on top
    tax_label = models.CharField(max_length=20, default="VAT")
    tax_registration_number = models.CharField(max_length=50, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="uniq_settings_per_org"),
            models.CheckConstraint(
                condition=Q(tax_rate__gte=0, tax_rate__lte=100), name="settings_tax_rate_0_100"
            ),
        ]


class Branch(TenantModel):
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "name"], name="uniq_branch")]


class Location(TenantModel):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="locations")
    name = models.CharField(max_length=100)
    is_default = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["branch"], condition=Q(is_default=True), name="uniq_default_location"
            )
        ]


class Register(TenantModel):
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, related_name="registers")
    name = models.CharField(max_length=100)
    is_default = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["branch"], condition=Q(is_default=True), name="uniq_default_register"
            )
        ]
