from rest_framework import serializers

from apps.core.serializers import MoneyField, StrictSerializerMixin


class OpenShiftSerializer(StrictSerializerMixin, serializers.Serializer):
    opening_cash = MoneyField()


class CloseShiftSerializer(StrictSerializerMixin, serializers.Serializer):
    actual_closing_cash = MoneyField()
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
