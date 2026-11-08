from rest_framework import serializers

from apps.core.serializers import CostField, QtyField, StrictSerializerMixin

from .models import Ingredient, StockBalance, StockMovement


class IngredientSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    low_stock_threshold = QtyField(required=False, allow_null=True, min_value=0)
    reference_unit_cost = CostField(required=False, allow_null=True, min_value=0)

    class Meta:
        model = Ingredient
        fields = [
            "id",
            "name",
            "base_unit",
            "low_stock_threshold",
            "reference_unit_cost",
            "is_active",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"name": {"validators": []}}

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is not None:  # base_unit is create-only: the ledger depends on it
            fields["base_unit"].read_only = True
        return fields

    def validate_name(self, value):
        org = self.context["request"].user.organization
        qs = Ingredient.objects.filter(organization=org, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("An ingredient with this name already exists.")
        return value


class BalanceSerializer(serializers.ModelSerializer):
    ingredient_id = serializers.UUIDField(read_only=True)
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    base_unit = serializers.CharField(source="ingredient.base_unit", read_only=True)
    is_active = serializers.BooleanField(source="ingredient.is_active", read_only=True)
    low_stock_threshold = QtyField(source="ingredient.low_stock_threshold", read_only=True)
    is_low = serializers.SerializerMethodField()
    is_negative = serializers.SerializerMethodField()
    qty = QtyField(read_only=True)

    class Meta:
        model = StockBalance
        fields = [
            "ingredient_id",
            "ingredient_name",
            "base_unit",
            "is_active",
            "location_id",
            "qty",
            "low_stock_threshold",
            "is_low",
            "is_negative",
        ]

    def get_is_low(self, b) -> bool:
        t = b.ingredient.low_stock_threshold
        return t is not None and b.qty <= t

    def get_is_negative(self, b) -> bool:
        return b.qty < 0


class MovementSerializer(serializers.ModelSerializer):
    ingredient_id = serializers.UUIDField(read_only=True)
    ingredient_name = serializers.CharField(source="ingredient.name", read_only=True)
    base_unit = serializers.CharField(source="ingredient.base_unit", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    qty_delta = QtyField(read_only=True)
    balance_after = QtyField(read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id",
            "ingredient_id",
            "ingredient_name",
            "base_unit",
            "qty_delta",
            "movement_type",
            "source_type",
            "source_id",
            "balance_after",
            "created_by_username",
            "occurred_at",
        ]


class AdjustmentInputSerializer(StrictSerializerMixin, serializers.Serializer):
    ingredient_id = serializers.UUIDField()
    mode = serializers.ChoiceField(choices=["delta", "count"])
    qty_delta = QtyField(required=False)
    counted_qty = QtyField(required=False, min_value=0)
    reason = serializers.CharField(max_length=300)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A reason is required.")
        return value.strip()

    def validate(self, a):
        if a["mode"] == "delta":
            if "qty_delta" not in a or a["qty_delta"] == 0:
                raise serializers.ValidationError(
                    {"qty_delta": "A non-zero qty_delta is required."}
                )
            if "counted_qty" in a:
                raise serializers.ValidationError({"counted_qty": "Not allowed in delta mode."})
        else:
            if "counted_qty" not in a:
                raise serializers.ValidationError({"counted_qty": "counted_qty is required."})
            if "qty_delta" in a:
                raise serializers.ValidationError({"qty_delta": "Not allowed in count mode."})
        return a


class OpeningItemSerializer(StrictSerializerMixin, serializers.Serializer):
    ingredient_id = serializers.UUIDField()
    qty = QtyField(min_value=0)

    def validate_qty(self, v):
        if v <= 0:
            raise serializers.ValidationError("Must be greater than 0.")
        return v


class OpeningBalancesSerializer(StrictSerializerMixin, serializers.Serializer):
    items = OpeningItemSerializer(many=True, allow_empty=False)
