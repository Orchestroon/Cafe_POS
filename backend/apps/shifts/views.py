from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import idempotency
from apps.core.pagination import EnvelopePagination
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm

from . import services
from .models import CashierShift
from .selectors import cash_movement_dict, list_shifts, shift_payload
from .serializers import (
    CashMovementSerializer,
    CloseShiftSerializer,
    OpenShiftSerializer,
    VoidCashMovementSerializer,
)


class CurrentShiftView(APIView):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "shifts.own"}

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        shift = services.current_shift(request.user)
        if shift:
            return Response({"data": shift_payload(shift), "meta": {}})
        # C2 (owner, 2026-11-11): with no open shift, show the user's last close as information.
        return Response({"data": None, "meta": {"last_closed": services.last_closed(request.user)}})


class OpenShiftView(APIView):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "shifts.own"}

    @extend_schema(request=OpenShiftSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request):
        ser = OpenShiftSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        shift = services.open_shift(request.user, ser.validated_data["opening_cash"])
        shift = services.current_shift(request.user)
        return Response(shift_payload(shift), status=201)


class ShiftViewSet(viewsets.GenericViewSet):
    """List: Admin. Detail and close: the shift's owner or an Admin (spec 9.3)."""

    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "shifts.own"}
    pagination_class = EnvelopePagination
    filter_backends = []
    queryset = CashierShift.objects.none()

    @extend_schema(operation_id="shifts_list", responses=OpenApiTypes.OBJECT)
    def list(self, request):
        if not has_perm(request.user, "shifts.manage"):
            raise PermissionDenied()
        page = self.paginate_queryset(list_shifts(request.user.organization, request.query_params))
        return self.get_paginated_response([shift_payload(s, detail=False) for s in page])

    def _shift(self, pk):
        shift = services.get_visible(self.request.user, pk)
        if shift is None:
            raise NotFound()
        return shift

    @extend_schema(operation_id="shifts_retrieve", responses=OpenApiTypes.OBJECT)
    def retrieve(self, request, pk=None):
        return Response(shift_payload(self._shift(pk)))

    @extend_schema(request=CloseShiftSerializer, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        ser = CloseShiftSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        shift = services.close_shift(request.user, pk, d["actual_closing_cash"], d["note"].strip())
        return Response(shift_payload(shift))


class CashMovementView(APIView):
    """POST /shifts/current/cash-movements: cash in/out of my own open drawer (Idempotency-Key)."""

    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "shifts.own"}

    @extend_schema(request=CashMovementSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request):
        ser = CashMovementSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        key = idempotency.parse_key(request)
        d = ser.validated_data
        result = idempotency.run_idempotent(
            organization=request.user.organization,
            user=request.user,
            scope="cash_movement",
            key=key,
            payload={**d, "amount": str(d["amount"])},
            handler=lambda: services.move_cash(request.user, d, key),
        )
        return Response(result.body, status=result.status, headers=result.headers())


class VoidCashMovementView(APIView):
    """POST /cash-movements/{id}/void (Admin, while the shift is open)."""

    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "shifts.manage"}

    @extend_schema(request=VoidCashMovementSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        ser = VoidCashMovementSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        m = services.void_cash_movement(request.user, pk, ser.validated_data["reason"])
        return Response(cash_movement_dict(m))
