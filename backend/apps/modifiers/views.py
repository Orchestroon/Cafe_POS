from django.db.models import Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.audited import create_obj, update_obj
from apps.core.mixins import TenantScopedViewSetMixin
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm

from . import services
from .models import ModifierEffect, ModifierGroup, ModifierOption
from .presenters import option_dict
from .serializers import GroupSerializer, OptionInputSerializer, OptionPatchSerializer

GROUP_FIELDS = [
    "name",
    "mode",
    "replacement_slot",
    "min_select",
    "max_select",
    "sort_order",
    "is_active",
]


def option_queryset(admin):
    qs = ModifierOption.objects.prefetch_related("prices")
    if admin:
        qs = qs.prefetch_related(
            Prefetch("effects", ModifierEffect.objects.select_related("ingredient"))
        )
    return qs


class ModifierGroupViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = GroupSerializer
    permission_classes = [PolicyPermission]
    permissions_by_method = {"GET": "modifiers.view", "*": "modifiers.manage"}
    http_method_names = ["get", "post", "patch", "head", "options"]
    queryset = ModifierGroup.objects.all()
    filterset_fields = ["is_active", "mode"]
    search_fields = ["name"]

    def get_queryset(self):
        admin = has_perm(self.request.user, "modifiers.manage")
        qs = super().get_queryset()
        if not admin:
            qs = qs.filter(is_active=True)
        opts = option_queryset(admin)
        if not admin:
            opts = opts.filter(is_active=True)
        return qs.prefetch_related(Prefetch("options", opts)).order_by("sort_order", "name")

    def perform_create(self, serializer):
        create_obj(self.request.user, serializer, "modifier_group.created", GROUP_FIELDS)

    def perform_update(self, serializer):
        update_obj(self.request.user, serializer, "modifier_group.updated")

    @extend_schema(request=OptionInputSerializer, responses={201: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"], url_path="options")
    def create_option(self, request, pk=None):
        group = self.get_object()
        ser = OptionInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        option = services.create_option(request.user, group, ser.validated_data)
        option = option_queryset(True).get(pk=option.pk)
        return Response(option_dict(option, effects=True), status=201)


class ModifierOptionViewSet(
    TenantScopedViewSetMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    queryset = ModifierOption.objects.all()
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "modifiers.manage"}
    http_method_names = ["patch", "options"]

    @extend_schema(request=OptionPatchSerializer, responses=OpenApiTypes.OBJECT)
    def partial_update(self, request, *args, **kwargs):
        option = self.get_object()
        ser = OptionPatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        option = services.update_option(request.user, option, ser.validated_data)
        option = option_queryset(True).get(pk=option.pk)
        return Response(option_dict(option, effects=True))
