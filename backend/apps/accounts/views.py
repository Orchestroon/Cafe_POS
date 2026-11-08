from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import ApiError
from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import PolicyPermission
from apps.tenancy.models import OrganizationSettings
from apps.tenancy.serializers import SafeSettingsSerializer

from . import services
from .models import User
from .serializers import (
    LoginSerializer,
    ResetPasswordSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)
from .throttles import LoginIPThrottle, LoginUsernameThrottle


def _me_payload(user):
    s = OrganizationSettings.objects.get(organization=user.organization)
    return {
        "user": UserSerializer(user).data,
        "organization": {"id": user.organization_id, "name": user.organization.name},
        "settings": SafeSettingsSerializer(s).data,
    }


class CsrfView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        get_token(request)  # sets the csrftoken cookie
        return Response({"detail": "ok"})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginIPThrottle, LoginUsernameThrottle]

    @extend_schema(request=LoginSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = LoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        # authenticate() rejects inactive users; same error for both cases (no enumeration).
        user = authenticate(request, **ser.validated_data)
        if user is None:
            raise ApiError("INVALID_CREDENTIALS", "Invalid username or password.", 401)
        login(request, user)
        return Response(_me_payload(user))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        logout(request)
        return Response(status=204)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(_me_payload(request.user))


class UserViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    queryset = User.objects.all().order_by("username")
    serializer_class = UserSerializer
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "users.manage"}
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["role", "is_active"]
    search_fields = ["username", "display_name"]

    @extend_schema(request=UserCreateSerializer, responses={201: UserSerializer})
    def create(self, request, *args, **kwargs):
        ser = UserCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = services.create_user(request.user, **ser.validated_data)
        return Response(UserSerializer(user).data, status=201)

    @extend_schema(request=UserUpdateSerializer, responses=UserSerializer)
    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        ser = UserUpdateSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        user = services.update_user(request.user, user, ser.validated_data)
        return Response(UserSerializer(user).data)

    @extend_schema(request=ResetPasswordSerializer, responses={204: None})
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        user = self.get_object()
        ser = ResetPasswordSerializer(data=request.data, context={"target": user})
        ser.is_valid(raise_exception=True)
        services.reset_password(request.user, user, ser.validated_data["password"])
        if user.pk == request.user.pk:  # keep the admin's own session; all others still end
            update_session_auth_hash(request, user)
        return Response(status=204)
