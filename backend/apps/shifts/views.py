from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import PolicyPermission

from . import services
from .selectors import shift_payload
from .serializers import OpenShiftSerializer


class CurrentShiftView(APIView):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "shifts.own"}

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        shift = services.current_shift(request.user)
        return Response({"data": shift_payload(shift) if shift else None, "meta": {}})


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
