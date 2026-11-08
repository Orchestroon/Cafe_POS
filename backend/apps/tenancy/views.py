from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm

from .models import OrganizationSettings
from .serializers import SafeSettingsSerializer, SettingsSerializer
from .services import update_settings


class SettingsView(APIView):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"GET": "settings.view", "PATCH": "settings.manage"}

    def _obj(self, request):
        return OrganizationSettings.objects.get(organization=request.user.organization)

    @extend_schema(responses=SettingsSerializer)
    def get(self, request):
        s = self._obj(request)
        cls = (
            SettingsSerializer
            if has_perm(request.user, "settings.manage")
            else SafeSettingsSerializer
        )
        return Response(cls(s).data)

    @extend_schema(request=SettingsSerializer, responses=SettingsSerializer)
    def patch(self, request):
        s = self._obj(request)
        ser = SettingsSerializer(s, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        update_settings(request.user, s, ser.validated_data)
        return Response(SettingsSerializer(s).data)
