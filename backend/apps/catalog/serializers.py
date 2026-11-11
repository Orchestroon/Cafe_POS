from decimal import Decimal

from rest_framework import serializers

from apps.core.policy import has_perm
from apps.core.serializers import MoneyField, StrictSerializerMixin, _StringDecimalField
from apps.modifiers.presenters import options_list

from .models import Category, Product, ProductVariant


class CategorySerializer(StrictSerializerMixin, serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "sort_order", "is_active"]
        read_only_fields = ["id"]
        extra_kwargs = {"name": {"validators": []}}  # uniqueness handled below (tenant-aware)

    def validate_name(self, value):
        org = self.context["request"].user.organization
        qs = Category.objects.filter(organization=org, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A category with this name already exists.")
        return value


class VariantSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    price = MoneyField()
    sku = serializers.CharField(max_length=50, required=False, allow_null=True, allow_blank=True)
    has_recipe = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product_id",
            "label",
            "sku",
            "price",
            "sort_order",
            "is_active",
            "track_stock",
            "has_recipe",
        ]
        read_only_fields = ["id", "product_id", "has_recipe"]
        extra_kwargs = {"label": {"validators": []}}

    def get_has_recipe(self, obj) -> bool:
        annotated = getattr(obj, "has_recipe", None)  # set by the products list prefetch
        return obj.recipe_lines.exists() if annotated is None else bool(annotated)

    def validate_sku(self, value):
        return value or None  # blank means "no SKU" so the partial unique index ignores it

    def validate(self, attrs):
        org = self.context["request"].user.organization
        product = self.context.get("product") or self.instance.product
        label = attrs.get("label")
        if label is not None:
            qs = ProductVariant.objects.filter(product=product, label__iexact=label)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"label": "This size already exists."})
        sku = attrs.get("sku")
        if sku:
            qs = ProductVariant.objects.filter(organization=org, sku=sku)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({"sku": "This SKU is already used."})
        return attrs


class ProductSerializer(StrictSerializerMixin, serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        source="category", queryset=Category.objects.none()
    )
    variants = VariantSerializer(many=True, read_only=True)
    modifier_groups = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "category_id",
            "name",
            "description",
            "sort_order",
            "is_active",
            "variants",
            "modifier_groups",
        ]
        read_only_fields = ["id"]
        extra_kwargs = {"name": {"validators": []}}

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            self.fields["category_id"].queryset = Category.objects.filter(
                organization=request.user.organization
            )

    def get_modifier_groups(self, obj) -> list[dict]:
        admin = has_perm(self.context["request"].user, "catalog.manage")
        return [
            {
                "group_id": link.group_id,
                "name": link.group.name,
                "sort_order": link.sort_order,
                "mode": link.group.mode,
                "min_select": link.group.min_select,
                "max_select": link.group.max_select,
                "is_active": link.group.is_active,
                "options": options_list(link.group, include_inactive=admin),
            }
            for link in obj.modifier_links.all()
        ]

    def validate_name(self, value):
        org = self.context["request"].user.organization
        qs = Product.objects.filter(organization=org, name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A product with this name already exists.")
        return value


class ModifierLinkSerializer(StrictSerializerMixin, serializers.Serializer):
    group_id = serializers.UUIDField()
    sort_order = serializers.IntegerField(default=0)


class RecipeLineInputSerializer(StrictSerializerMixin, serializers.Serializer):
    """Types only; ranges, ingredients and duplicates are checked in the service."""

    ingredient_id = serializers.UUIDField()
    base_qty = _StringDecimalField(max_digits=14, decimal_places=3)
    waste_pct = _StringDecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    slot_key = serializers.SlugField(max_length=50, required=False, allow_null=True, default=None)


class RecipeInputSerializer(StrictSerializerMixin, serializers.Serializer):
    lines = RecipeLineInputSerializer(many=True, max_length=100)
