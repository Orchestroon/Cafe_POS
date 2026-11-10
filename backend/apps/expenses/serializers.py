from decimal import Decimal

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


class ExpenseVoidSerializer(StrictSerializerMixin, serializers.Serializer):
    reason = serializers.CharField(min_length=3, max_length=300)
