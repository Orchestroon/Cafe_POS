from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.core.pagination import EnvelopePagination
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm

from . import services
from .models import Promotion
from .serializers import PromotionInputSerializer


class PromotionViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Admin: every promotion with its full rules. Barista: only the active ones, by name (the
    quote tells the POS what applies; the rules and the schedule stay with the Admin)."""

    permission_classes = [PolicyPermission]

    @property
    def permissions_by_method(self):
        if getattr(self, "action", None) == "variant_costs":  # recipe costs: Admin only
            return {"*": "promotions.manage"}
        return {"GET": "promotions.view", "*": "promotions.manage"}

    pagination_class = EnvelopePagination
    filter_backends = []
    queryset = Promotion.objects.none()
    http_method_names = ["get", "post", "patch", "options"]

    def get_queryset(self):
        qs = services.queryset(self.request.user.organization)
        if not has_perm(self.request.user, "promotions.manage"):
            qs = qs.filter(is_active=True)
        return qs

    def _out(self, p):
        now = services.local_now(self.request.user.organization)
        if has_perm(self.request.user, "promotions.manage"):
            return services.full_dict(p, now)
        return {"id": str(p.pk), "name": p.name, "kind": p.kind, "auto_apply": p.auto_apply}

    def _input(self, data, instance=None):
        ser = PromotionInputSerializer(
            data=data, instance=instance, context={"request": self.request}
        )
        ser.is_valid(raise_exception=True)
        return ser.validated_data

    @extend_schema(operation_id="promotions_list", responses=OpenApiTypes.OBJECT)
    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([self._out(p) for p in page])

    @extend_schema(operation_id="promotions_retrieve", responses=OpenApiTypes.OBJECT)
    def retrieve(self, request, *args, pk=None, **kwargs):
        p = self.get_queryset().filter(pk=pk).first()
        if p is None:
            raise NotFound()
        return Response(self._out(p))

    @extend_schema(request=PromotionInputSerializer, responses={201: OpenApiTypes.OBJECT})
    def create(self, request, *args, **kwargs):
        p = services.create_promotion(request.user, self._input(request.data))
        return Response(self._out(p), status=201)

    @extend_schema(request=PromotionInputSerializer, responses=OpenApiTypes.OBJECT)
    def partial_update(self, request, *args, pk=None, **kwargs):
        current = self.get_queryset().filter(pk=pk).first()
        if current is None:
            raise NotFound()
        merged = {**services.promotion_dict(current), **request.data}
        p = services.update_promotion(request.user, pk, self._input(merged, current))
        return Response(self._out(p))

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"], url_path="variant-costs")
    def variant_costs(self, request):
        """Recipe cost of every active size (before extras), so the form can warn when a
        promotion sells below cost. Cost is None when an ingredient has no average cost yet."""
        return Response(services.variant_costs(request.user.organization))
