from decimal import Decimal

from rest_framework import serializers

from apps.core.serializers import MoneyField, StrictSerializerMixin


class OpenShiftSerializer(StrictSerializerMixin, serializers.Serializer):
    opening_cash = MoneyField()


class CloseShiftSerializer(StrictSerializerMixin, serializers.Serializer):
    actual_closing_cash = MoneyField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class _Reason(serializers.CharField):
    def __init__(self, **kw):
        super().__init__(max_length=300, **kw)

    def to_internal_value(self, data):
        value = super().to_internal_value(data).strip()
        if not value:
            raise serializers.ValidationError("A reason is required.")
        return value


class CashMovementSerializer(StrictSerializerMixin, serializers.Serializer):
    kind = serializers.ChoiceField(choices=["in", "out"])
    amount = MoneyField(min_value=Decimal("0.01"))
    reason = _Reason()


class VoidCashMovementSerializer(StrictSerializerMixin, serializers.Serializer):
    reason = _Reason()
