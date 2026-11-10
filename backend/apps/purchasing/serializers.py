from decimal import Decimal

from rest_framework import serializers

from apps.core.serializers import CostField, QtyField, StrictSerializerMixin

from .models import Purchase, Supplier


class SupplierSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "notes", "is_active"]
        read_only_fields = ["id"]
        extra_kwargs = {"name": {"validators": []}}

    def validate_name(self, value):
        org = self.context["request"].user.organization
        qs = Supplier.objects.filter(organization=org, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A supplier with this name already exists.")
        return value


class PurchaseItemInputSerializer(StrictSerializerMixin, serializers.Serializer):
    ingredient_id = serializers.UUIDField()
    qty = QtyField(required=False, min_value=Decimal("0.001"))
    unit_cost = CostField(min_value=0)
    pack_label = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    pack_count = QtyField(required=False, allow_null=True, min_value=Decimal("0.001"))
    pack_size = QtyField(required=False, allow_null=True, min_value=Decimal("0.001"))

    def validate(self, attrs):
        # On a PATCH the root is `partial`, which DRF also applies to these nested fields.
        missing = {
            f: "This field is required." for f in ("ingredient_id", "unit_cost") if f not in attrs
        }
        if missing:
            raise serializers.ValidationError(missing)
        count, size, qty = attrs.get("pack_count"), attrs.get("pack_size"), attrs.get("qty")
        if (count is None) != (size is None):
            raise serializers.ValidationError("pack_count and pack_size go together.")
        if count is not None:
            packed = count * size
            if qty is not None and qty != packed:
                raise serializers.ValidationError("qty must equal pack_count x pack_size.")
            attrs["qty"] = packed
        elif qty is None:
            raise serializers.ValidationError("Send qty, or pack_count and pack_size.")
        return attrs


class PurchaseInputSerializer(StrictSerializerMixin, serializers.Serializer):
    supplier_id = serializers.UUIDField(required=False, allow_null=True)
    supplier_invoice_no = serializers.CharField(max_length=60, required=False, allow_blank=True)
    purchased_on = serializers.DateField()
    payment_method = serializers.ChoiceField(choices=Purchase.Method.values, required=False)
    source = serializers.ChoiceField(choices=Purchase.Source.values, required=False)
    notes = serializers.CharField(max_length=300, required=False, allow_blank=True)
    items = PurchaseItemInputSerializer(many=True, allow_empty=True, max_length=200)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.partial:  # PATCH: every key is optional; `items`, when sent, replaces all lines
            for f in self.fields.values():
                f.required = False
