from django.db.models import Exists, OuterRef, Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.audited import create_obj, update_obj
from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm
from apps.modifiers.models import ModifierOption, ProductModifierGroup

from . import services
from .models import Category, Product, ProductVariant, RecipeLine
from .serializers import (
    CategorySerializer,
    ModifierLinkSerializer,
    ProductSerializer,
    RecipeInputSerializer,
    VariantSerializer,
)

CATEGORY_FIELDS = ["name", "sort_order", "is_active"]
PRODUCT_FIELDS = ["category_id", "name", "description", "sort_order", "is_active"]
VARIANT_FIELDS = ["label", "sku", "price", "sort_order", "is_active", "track_stock"]


class _CatalogBase(TenantScopedViewSetMixin, viewsets.GenericViewSet):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"GET": "catalog.view", "*": "catalog.manage"}
    http_method_names = ["get", "post", "patch", "put", "head", "options"]

    @property
    def is_admin(self):
        return has_perm(self.request.user, "catalog.manage")


class CategoryViewSet(
    _CatalogBase,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    filterset_fields = ["is_active"]
    search_fields = ["name"]

    def get_queryset(self):
        qs = super().get_queryset()
        return qs if self.is_admin else qs.filter(is_active=True)

    def perform_create(self, serializer):
        create_obj(self.request.user, serializer, "category.created", CATEGORY_FIELDS)

    def perform_update(self, serializer):
        update_obj(self.request.user, serializer, "category.updated")


class ProductViewSet(
    _CatalogBase,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
):
    queryset = Product.objects.select_related("category")
    serializer_class = ProductSerializer
    filterset_fields = ["is_active"]
    search_fields = ["name"]

    def get_queryset(self):
        qs = super().get_queryset()
        variants = ProductVariant.objects.annotate(
            has_recipe=Exists(RecipeLine.objects.filter(variant=OuterRef("pk")))
        )
        if not self.is_admin:  # Barista: only what can be sold
            qs = qs.filter(is_active=True, category__is_active=True)
            variants = variants.filter(is_active=True)
        cat = self.request.query_params.get("category_id")
        if cat:
            qs = qs.filter(category_id=cat)
        links = ProductModifierGroup.objects.select_related("group")
        options = ModifierOption.objects.prefetch_related("prices")
        if not self.is_admin:
            links = links.filter(group__is_active=True)
            options = options.filter(is_active=True)
        links = links.prefetch_related(Prefetch("group__options", queryset=options))
        return qs.prefetch_related(
            Prefetch("variants", queryset=variants),
            Prefetch("modifier_links", queryset=links),
        )

    def perform_create(self, serializer):
        create_obj(self.request.user, serializer, "product.created", PRODUCT_FIELDS)

    def perform_update(self, serializer):
        update_obj(self.request.user, serializer, "product.updated")

    @extend_schema(request=VariantSerializer, responses={201: VariantSerializer})
    @action(detail=True, methods=["post"], url_path="variants")
    def create_variant(self, request, pk=None):
        product = self.get_object()
        ser = VariantSerializer(data=request.data, context={"request": request, "product": product})
        ser.is_valid(raise_exception=True)
        variant = create_obj(request.user, ser, "variant.created", VARIANT_FIELDS, product=product)
        return Response(VariantSerializer(variant, context={"request": request}).data, status=201)

    @extend_schema(request=ModifierLinkSerializer(many=True), responses=ProductSerializer)
    @action(detail=True, methods=["put"], url_path="modifier-groups")
    def modifier_groups(self, request, pk=None):
        product = self.get_object()
        ser = ModifierLinkSerializer(data=request.data, many=True)
        ser.is_valid(raise_exception=True)
        services.replace_modifier_groups(request.user, product, ser.validated_data)
        product = self.get_queryset().get(pk=product.pk)
        return Response(ProductSerializer(product, context={"request": request}).data)


class VariantViewSet(TenantScopedViewSetMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = ProductVariant.objects.select_related("product")
    serializer_class = VariantSerializer
    permission_classes = [PolicyPermission]
    http_method_names = ["get", "patch", "put", "options"]

    @property
    def permissions_by_method(self):
        if getattr(self, "action", None) == "recipe":
            return {"*": "recipes.manage"}
        return {"*": "catalog.manage"}

    def perform_update(self, serializer):
        services.update_variant(self.request.user, serializer)

    @extend_schema(request=RecipeInputSerializer, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get", "put"], url_path="recipe")
    def recipe(self, request, pk=None):
        variant = self.get_object()
        if request.method == "PUT":
            ser = RecipeInputSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            variant = services.replace_recipe(request.user, variant, ser.validated_data["lines"])
        return Response(services.recipe_payload(variant))
