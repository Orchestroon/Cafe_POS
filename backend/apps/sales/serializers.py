from decimal import Decimal

from rest_framework import serializers

from apps.core.serializers import QtyField, StrictSerializerMixin, _StringDecimalField


class CartItemSerializer(StrictSerializerMixin, serializers.Serializer):
    variant_id = serializers.UUIDField()
    # JSONField so 0, 100, "2" or 1.5 reach the engine, which answers INVALID_QUANTITY (spec 8.1).
    quantity = serializers.JSONField()
    modifier_option_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=30
    )


class QuoteSerializer(StrictSerializerMixin, serializers.Serializer):
    items = CartItemSerializer(many=True, allow_empty=True, max_length=100)


class PaymentInputSerializer(StrictSerializerMixin, serializers.Serializer):
    """Types only: amount rules (> 0, tendered >= amount, sum = total) answer 422 in the service."""

    method = serializers.ChoiceField(choices=["cash", "card"])
    amount = _StringDecimalField(max_digits=12, decimal_places=2)
    cash_tendered = _StringDecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )
    external_reference = serializers.CharField(
        max_length=100, required=False, allow_blank=True, allow_null=True
    )


class CheckoutSerializer(StrictSerializerMixin, serializers.Serializer):
    items = CartItemSerializer(many=True, allow_empty=True, max_length=100)
    payments = PaymentInputSerializer(many=True, allow_empty=True, max_length=10)
    expected_total = _StringDecimalField(max_digits=12, decimal_places=2)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class RefundSerializer(StrictSerializerMixin, serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=300)
    confirm_amount = _StringDecimalField(max_digits=12, decimal_places=2)
    card_external_reference = serializers.CharField(
        max_length=100, required=False, allow_blank=True, allow_null=True
    )


class ReturnLineSerializer(StrictSerializerMixin, serializers.Serializer):
    ingredient_id = serializers.UUIDField()
    qty = QtyField(min_value=Decimal("0.001"))


class StockReturnSerializer(StrictSerializerMixin, serializers.Serializer):
    reason = serializers.CharField(max_length=300)
    lines = ReturnLineSerializer(many=True, allow_empty=False, max_length=100)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A reason is required.")
        return value.strip()

    def validate_lines(self, lines):
        ids = [line["ingredient_id"] for line in lines]
        if len(set(ids)) != len(ids):
            raise serializers.ValidationError("Each ingredient once.")
        return lines
