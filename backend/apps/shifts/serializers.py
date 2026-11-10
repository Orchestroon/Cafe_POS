from rest_framework import serializers

from apps.core.serializers import MoneyField, StrictSerializerMixin


class OpenShiftSerializer(StrictSerializerMixin, serializers.Serializer):
    opening_cash = MoneyField()
