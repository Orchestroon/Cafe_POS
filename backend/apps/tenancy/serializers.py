from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from apps.core.serializers import StrictSerializerMixin, _StringDecimalField

from .models import OrganizationSettings

SAFE_FIELDS = [
    "currency",
    "timezone",
    "default_language",
    "business_name",
    "receipt_header",
    "receipt_footer",
    "receipt_paper_width",
    "tax_enabled",
    "tax_rate",
    "prices_include_tax",
    "tax_label",
    "tax_registration_number",
]


class SafeSettingsSerializer(serializers.ModelSerializer):
    """Everything except invoice_prefix: what a Barista may see."""

    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)

    class Meta:
        model = OrganizationSettings
        fields = SAFE_FIELDS


class SettingsSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    tax_rate = _StringDecimalField(max_digits=5, decimal_places=2, min_value=0, max_value=100)

    class Meta:
        model = OrganizationSettings
        fields = [*SAFE_FIELDS, "invoice_prefix"]

    def validate_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError("Unknown IANA timezone.") from None
        return value

    def validate_currency(self, value):
        if not (len(value) == 3 and value.isalpha() and value.isupper()):
            raise serializers.ValidationError("Use a 3-letter uppercase code, e.g. EGP.")
        return value

    def validate_default_language(self, value):
        if value not in ("en", "ar"):
            raise serializers.ValidationError("Use 'en' or 'ar'.")
        return value

    def validate_invoice_prefix(self, value):
        if not value.strip():
            raise serializers.ValidationError("Cannot be empty.")
        return value
