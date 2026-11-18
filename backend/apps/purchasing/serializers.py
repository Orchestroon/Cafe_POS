from decimal import Decimal

from rest_framework import serializers

from apps.core.serializers import CostField, MoneyField, QtyField, StrictSerializerMixin

from .models import Purchase, Supplier


class SupplierSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    # Sprint 5 P4: what we still owe this supplier (credit purchases minus payments).
    owed = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "notes", "is_active", "owed"]
        read_only_fields = ["id", "owed"]
        extra_kwargs = {"name": {"validators": []}}

    def get_owed(self, s) -> str:
        v = getattr(s, "owed_total", None)
        return str(v if v is not None else Decimal("0.00"))

    def validate_name(self, value):
        org = self.context["request"].user.organization
        qs = Supplier.objects.filter(organization=org, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A supplier with this name already exists.")
        return value


class PurchaseItemInputSerializer(StrictSerializerMixin, serializers.Serializer):
    """A line is what was bought and what was paid for it; the system works out the cost per
    unit (Sprint 5 L4, owner 2026-11-17: "500 kg for 785"). Either quantity + line total, or by
    pack: pack count x pack size at a price per pack."""

    ingredient_id = serializers.UUIDField()
    qty = QtyField(required=False, min_value=Decimal("0.001"))
    line_total = MoneyField(required=False)
    pack_cost = CostField(required=False, allow_null=True, min_value=0)
    pack_label = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    pack_count = QtyField(required=False, allow_null=True, min_value=Decimal("0.001"))
    pack_size = QtyField(required=False, allow_null=True, min_value=Decimal("0.001"))

    def validate(self, attrs):
        # On a PATCH the root is `partial`, which DRF also applies to these nested fields.
        if "ingredient_id" not in attrs:
            raise serializers.ValidationError({"ingredient_id": "This field is required."})
        pack_cost = attrs.get("pack_cost")
        count, size, qty = attrs.get("pack_count"), attrs.get("pack_size"), attrs.get("qty")
        if pack_cost is not None:
            if count is None or size is None:
                raise serializers.ValidationError({"pack_cost": "Send pack_count and pack_size."})
            if "line_total" in attrs:
                raise serializers.ValidationError(
                    {"line_total": "Send pack_cost or line_total, not both."}
                )
            packed = count * size
            if qty is not None and qty != packed:
                raise serializers.ValidationError("qty must equal pack_count x pack_size.")
            attrs["qty"] = packed
            return attrs
        if count is not None or size is not None:
            raise serializers.ValidationError({"pack_cost": "A pack line needs its pack price."})
        missing = {f: "This field is required." for f in ("qty", "line_total") if f not in attrs}
        if missing:
            raise serializers.ValidationError(missing)
        return attrs


class PurchaseInputSerializer(StrictSerializerMixin, serializers.Serializer):
    supplier_id = serializers.UUIDField(required=False, allow_null=True)
    supplier_invoice_no = serializers.CharField(max_length=60, required=False, allow_blank=True)
    purchased_on = serializers.DateField()
    payment_method = serializers.ChoiceField(choices=Purchase.Method.values, required=False)
    source = serializers.ChoiceField(choices=Purchase.Source.values, required=False)
    notes = serializers.CharField(max_length=300, required=False, allow_blank=True)
    on_credit = serializers.BooleanField(required=False)
    items = PurchaseItemInputSerializer(many=True, allow_empty=True, max_length=200)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.partial:  # PATCH: every key is optional; `items`, when sent, replaces all lines
            for f in self.fields.values():
                f.required = False


class VoidPurchaseSerializer(StrictSerializerMixin, serializers.Serializer):
    reason = serializers.CharField(max_length=300)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A reason is required.")
        return value.strip()


class PaymentLineInputSerializer(StrictSerializerMixin, serializers.Serializer):
    purchase_id = serializers.UUIDField()
    amount = MoneyField(min_value=Decimal("0.01"))


class SupplierPaymentInputSerializer(StrictSerializerMixin, serializers.Serializer):
    supplier_id = serializers.UUIDField()
    source = serializers.ChoiceField(choices=Purchase.Source.values)
    payment_method = serializers.ChoiceField(choices=Purchase.Method.values)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    lines = PaymentLineInputSerializer(many=True, allow_empty=False, max_length=100)

    def validate(self, attrs):
        if attrs["source"] == Purchase.Source.CASH_DRAWER and attrs["payment_method"] != "cash":
            raise serializers.ValidationError({"payment_method": "A drawer payment is cash."})
        ids = [line["purchase_id"] for line in attrs["lines"]]
        if len(set(ids)) != len(ids):
            raise serializers.ValidationError({"lines": "Each purchase once."})
        return attrs
