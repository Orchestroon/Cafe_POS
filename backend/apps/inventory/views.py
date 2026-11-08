from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import PolicyPermission

from . import services
from .filters import BalanceFilter, MovementFilter
from .models import Ingredient, StockBalance, StockMovement
from .serializers import (
    AdjustmentInputSerializer,
    BalanceSerializer,
    IngredientSerializer,
    MovementSerializer,
    OpeningBalancesSerializer,
)

ADMIN_ONLY = {
    "permission_classes": [PolicyPermission],
    "permissions_by_method": {"*": "inventory.manage"},
}


class IngredientViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Ingredient.objects.all()
    serializer_class = IngredientSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["is_active", "base_unit"]
    search_fields = ["name"]
    permission_classes = ADMIN_ONLY["permission_classes"]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]

    def perform_create(self, serializer):
        services.create_ingredient(self.request.user, serializer)

    def perform_update(self, serializer):
        services.update_ingredient(self.request.user, serializer)


class BalanceViewSet(TenantScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = StockBalance.objects.select_related("ingredient").order_by("ingredient__name")
    serializer_class = BalanceSerializer
    filterset_class = BalanceFilter
    permission_classes = ADMIN_ONLY["permission_classes"]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]
    ordering_fields = ["qty", "ingredient__name"]


class MovementViewSet(TenantScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = StockMovement.objects.select_related("ingredient", "created_by")
    serializer_class = MovementSerializer
    filterset_class = MovementFilter
    permission_classes = ADMIN_ONLY["permission_classes"]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]
    ordering_fields = ["occurred_at", "qty_delta"]


class AdjustmentView(APIView):
    permission_classes = ADMIN_ONLY["permission_classes"]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]

    def post(self, request):
        ser = AdjustmentInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        adj, movement, bal = services.adjust_stock(request.user, **ser.validated_data)
        return Response(
            {
                "adjustment_id": adj.id,
                "kind": adj.kind,
                "qty_delta": str(adj.qty_delta),
                "balance_after": str(bal.qty),
                "movement_id": movement.id if movement else None,
            },
            status=201,
        )


class OpeningBalancesView(APIView):
    permission_classes = ADMIN_ONLY["permission_classes"]
    permissions_by_method = ADMIN_ONLY["permissions_by_method"]

    def post(self, request):
        ser = OpeningBalancesSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        balances = services.set_opening_balances(request.user, ser.validated_data["items"])
        return Response(
            {
                "items": [
                    {"ingredient_id": b.ingredient_id, "balance": str(b.qty)} for b in balances
                ]
            },
            status=201,
        )
