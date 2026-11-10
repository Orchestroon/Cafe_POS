from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.core.serializers import MoneyField, StrictSerializerMixin

from .models import Expense

GENERAL_CATEGORIES = [c for c in Expense.Category.values if c != Expense.Category.PURCHASE]


class ExpenseCreateSerializer(StrictSerializerMixin, serializers.Serializer):
    category = serializers.ChoiceField(choices=GENERAL_CATEGORIES)
    description = serializers.CharField(min_length=1, max_length=300)
    amount = MoneyField(min_value=Decimal("0.01"))
    # Admin only: a Barista's values are ignored (forced to cash from their own drawer, D10).
    payment_method = serializers.ChoiceField(choices=Expense.Method.values, required=False)
    source = serializers.ChoiceField(choices=Expense.Source.values, required=False)
    # Admin only (ignored for a Barista); never in the future.
    paid_at = serializers.DateTimeField(required=False)

    def validate_paid_at(self, value):
        if value > timezone.now():
            raise serializers.ValidationError("paid_at cannot be in the future.")
        return value


class ExpenseVoidSerializer(StrictSerializerMixin, serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=300)
