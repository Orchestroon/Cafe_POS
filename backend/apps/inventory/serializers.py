from decimal import Decimal

from rest_framework import serializers

from apps.core.serializers import MoneyField, QtyField, StrictSerializerMixin

from .models import Ingredient, StockBalance, StockMovement


class IngredientSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    low_stock_threshold = QtyField(required=False, allow_null=True, min_value=0)
    # Read-only, from the stock balance (Sprint 5 L1): the cost is never typed on the ingredient.
    stock_qty = serializers.SerializerMethodField()
    avg_cost = serializers.SerializerMethodField()

    class Meta:
        model = Ingredient
        fields = [
            "id",
            "name",
            "base_unit",
            "low_stock_threshold",
            "stock_qty",
            "avg_cost",
            "is_active",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"name": {"validators": []}}

    def get_fields(self):
        fields = super().get_fields()
        if self.instance is not None:  # base_unit is create-only: the ledger depends on it
            fields["base_unit"].read_only = True
        return fields

    def _balance(self, ing):
        return next(iter(ing.balances.all()), None)  # one location in v1; prefetched by the view

    def get_stock_qty(self, ing) -> str | None:
        b = self._balance(ing)
        return None if b is None else str(b.qty)

    def get_avg_cost(self, ing) -> str | None:
        b = self._balance(ing)
        return None if b is None or b.avg_cost is None else str(b.avg_cost)

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
    unit_cost = serializers.SerializerMethodField()

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
            "unit_cost",
        ]

    def get_unit_cost(self, b) -> str | None:
        """Weighted average cost per base unit; None = unknown."""
        from .services import unit_cost

        c = unit_cost(b)
        return None if c is None else str(c)

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
            # Sprint 5 L2: stock is never added by hand. Bought: a purchase; already had it: an
            # opening balance with its value.
            if "qty_delta" not in a or a["qty_delta"] >= 0:
                raise serializers.ValidationError(
                    {"qty_delta": "Only stock going out (a negative quantity) is allowed."}
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
    qty = QtyField(min_value=Decimal("0.001"))
    total_value = MoneyField(min_value=Decimal("0.01"))  # Sprint 5 L3: the cost is always known


class OpeningBalancesSerializer(StrictSerializerMixin, serializers.Serializer):
    items = OpeningItemSerializer(many=True, allow_empty=False)
    reason = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")

    def validate_reason(self, value):
        return value.strip()
