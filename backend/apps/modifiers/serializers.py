from decimal import Decimal

from rest_framework import serializers

from apps.catalog.models import ProductVariant, RecipeLine
from apps.core.policy import has_perm
from apps.core.serializers import MoneyField, StrictSerializerMixin, _StringDecimalField

from .models import ModifierGroup
from .presenters import options_list


class GroupSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    options = serializers.SerializerMethodField()
    slot_warnings = serializers.SerializerMethodField()

    class Meta:
        model = ModifierGroup
        fields = [
            "id",
            "name",
            "mode",
            "replacement_slot",
            "min_select",
            "max_select",
            "sort_order",
            "is_active",
            "options",
            "slot_warnings",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {
            "name": {"validators": []},
            "replacement_slot": {"required": False, "allow_null": True},
            "min_select": {"min_value": 0},
            "max_select": {"min_value": 1},
        }

    def _admin(self):
        return has_perm(self.context["request"].user, "modifiers.manage")

    def get_options(self, obj) -> list[dict]:
        admin = self._admin()
        return options_list(obj, include_inactive=admin, effects=admin)

    def get_slot_warnings(self, obj) -> list[dict]:
        """Linked variants whose recipe lacks the slot this replace group needs (spec 8.10)."""
        if not self._admin() or obj.mode != "replace":
            return []
        have = set(
            RecipeLine.objects.filter(
                variant__product__modifier_links__group=obj, slot_key=obj.replacement_slot
            ).values_list("variant_id", flat=True)
        )
        variants = ProductVariant.objects.filter(
            product__modifier_links__group=obj, is_active=True
        ).select_related("product")
        return [
            {
                "product_id": str(v.product_id),
                "product_name": v.product.name,
                "variant_id": str(v.pk),
                "variant_label": v.label,
            }
            for v in variants
            if v.pk not in have
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self._admin():  # Barista: what the POS needs, nothing about stock
            data.pop("replacement_slot", None)
            data.pop("slot_warnings", None)
        return data

    def validate_name(self, value):
        org = self.context["request"].user.organization
        qs = ModifierGroup.objects.filter(organization=org, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A modifier group with this name already exists.")
        return value

    def validate(self, attrs):
        cur = self.instance
        get = lambda k, d=None: attrs.get(k, getattr(cur, k, d))  # noqa: E731
        mode, slot = get("mode"), get("replacement_slot")
        lo, hi = get("min_select", 0), get("max_select", 1)
        errors = {}
        if mode == "replace" and not slot:
            errors["replacement_slot"] = "Required for a replace group."
        if mode == "add" and slot:
            errors["replacement_slot"] = "Only a replace group has a slot."
        if hi < lo:
            errors["max_select"] = "Must be at least min_select."
        if errors:
            raise serializers.ValidationError(errors)
        if mode == "add":
            attrs["replacement_slot"] = None
        return attrs


class VariantPriceSerializer(StrictSerializerMixin, serializers.Serializer):
    variant_id = serializers.UUIDField()
    price_delta = MoneyField()


class EffectSerializer(StrictSerializerMixin, serializers.Serializer):
    variant_id = serializers.UUIDField(allow_null=True, default=None)
    ingredient_id = serializers.UUIDField()
    base_qty = _StringDecimalField(max_digits=14, decimal_places=3, min_value=0)
    waste_pct = _StringDecimalField(
        max_digits=5, decimal_places=2, min_value=0, max_value=100, default=Decimal("0.00")
    )


class OptionInputSerializer(StrictSerializerMixin, serializers.Serializer):
    label = serializers.CharField(max_length=100)
    price_delta = MoneyField(default=Decimal("0.00"))
    sort_order = serializers.IntegerField(default=0)
    is_active = serializers.BooleanField(default=True)
    track_stock = serializers.BooleanField(default=True)
    variant_prices = VariantPriceSerializer(many=True, required=False, max_length=50)
    effects = EffectSerializer(many=True, required=False, max_length=100)

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Cannot be empty.")
        return value


class OptionPatchSerializer(OptionInputSerializer):
    def __init__(self, *a, **kw):
        kw["partial"] = True
        super().__init__(*a, **kw)
