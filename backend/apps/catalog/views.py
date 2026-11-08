from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm
from apps.modifiers.models import ProductModifierGroup

from . import services
from .models import Category, Product, ProductVariant
from .serializers import (
    CategorySerializer,
    ModifierLinkSerializer,
    ProductSerializer,
    VariantSerializer,
)

CATEGORY_FIELDS = ["name", "sort_order", "is_active"]
PRODUCT_FIELDS = ["category_id", "name", "description", "sort_order", "is_active"]
VARIANT_FIELDS = ["label", "sku", "price", "sort_order", "is_active"]


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
        services.create_obj(self.request.user, serializer, "category.created", CATEGORY_FIELDS)

    def perform_update(self, serializer):
        services.update_obj(self.request.user, serializer, "category.updated")


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
        variants = ProductVariant.objects.all()
        if not self.is_admin:  # Barista: only what can be sold
            qs = qs.filter(is_active=True, category__is_active=True)
            variants = variants.filter(is_active=True)
        cat = self.request.query_params.get("category_id")
        if cat:
            qs = qs.filter(category_id=cat)
        return qs.prefetch_related(
            Prefetch("variants", queryset=variants),
            Prefetch(
                "modifier_links",
                queryset=ProductModifierGroup.objects.select_related("group"),
            ),
        )

    def perform_create(self, serializer):
        services.create_obj(self.request.user, serializer, "product.created", PRODUCT_FIELDS)

    def perform_update(self, serializer):
        services.update_obj(self.request.user, serializer, "product.updated")

    @extend_schema(request=VariantSerializer, responses={201: VariantSerializer})
    @action(detail=True, methods=["post"], url_path="variants")
    def create_variant(self, request, pk=None):
        product = self.get_object()
        ser = VariantSerializer(data=request.data, context={"request": request, "product": product})
        ser.is_valid(raise_exception=True)
        variant = services.create_obj(
            request.user, ser, "variant.created", VARIANT_FIELDS, product=product
        )
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
    permissions_by_method = {"*": "catalog.manage"}
    http_method_names = ["patch", "options"]

    def perform_update(self, serializer):
        services.update_obj(self.request.user, serializer, "variant.updated")
