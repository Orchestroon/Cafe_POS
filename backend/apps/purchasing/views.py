from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core import idempotency
from apps.core.audited import create_obj, update_obj
from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.pagination import EnvelopePagination
from apps.core.permissions import PolicyPermission

from . import services
from .models import Purchase, Supplier
from .serializers import PurchaseInputSerializer, SupplierSerializer

ADMIN_ONLY = {"permissions_by_method": {"*": "purchasing.manage"}}


class SupplierViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [PolicyPermission]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["is_active"]
    search_fields = ["name"]

    def perform_create(self, serializer):
        create_obj(
            self.request.user, serializer, "supplier.created", ["name", "phone", "is_active"]
        )

    def perform_update(self, serializer):
        update_obj(self.request.user, serializer, "supplier.updated")


class PurchaseViewSet(viewsets.GenericViewSet):
    permission_classes = [PolicyPermission]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]
    pagination_class = EnvelopePagination
    filter_backends = []
    queryset = Purchase.objects.none()

    def get_queryset(self):
        p = self.request.query_params
        qs = (
            Purchase.objects.filter(organization=self.request.user.organization)
            .select_related("supplier", "posted_by", "created_by")
            .prefetch_related("items__ingredient")
        )
        for param, field in (("status", "status"), ("supplier_id", "supplier_id")):
            if p.get(param):
                qs = qs.filter(**{field: p[param]})
        if p.get("from"):
            qs = qs.filter(purchased_on__gte=p["from"])
        if p.get("to"):
            qs = qs.filter(purchased_on__lte=p["to"])
        return qs

    @extend_schema(operation_id="purchases_list", responses=OpenApiTypes.OBJECT)
    def list(self, request):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([services.purchase_dict(p) for p in page])

    @extend_schema(operation_id="purchases_retrieve", responses=OpenApiTypes.OBJECT)
    def retrieve(self, request, pk=None):
        services.get_purchase(request.user.organization, pk)
        return Response(services.purchase_dict(services.detail(request.user.organization, pk)))

    @extend_schema(request=PurchaseInputSerializer, responses={201: OpenApiTypes.OBJECT})
    def create(self, request):
        ser = PurchaseInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        p = services.create_draft(request.user, ser.validated_data)
        return Response(services.purchase_dict(p), status=201)

    @extend_schema(request=PurchaseInputSerializer, responses=OpenApiTypes.OBJECT)
    def partial_update(self, request, pk=None):
        ser = PurchaseInputSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        return Response(
            services.purchase_dict(services.update_draft(request.user, pk, ser.validated_data))
        )

    @extend_schema(responses={204: None})
    def destroy(self, request, pk=None):
        services.delete_draft(request.user, pk)
        return Response(status=204)

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], url_path="post")
    def post_purchase(self, request, pk=None):
        key = idempotency.parse_key(request)
        result = idempotency.run_idempotent(
            organization=request.user.organization,
            user=request.user,
            scope=f"purchase_post:{pk}",
            key=key,
            payload={},
            handler=lambda: services.post_purchase(request.user, pk, key),
        )
        return Response(result.body, status=result.status, headers=result.headers())
