from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core.pagination import EnvelopePagination
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm
from apps.core.timeutils import parse_range
from apps.sales.selectors import org_timezone

from . import services
from .models import Expense
from .serializers import ExpenseCreateSerializer, ExpenseVoidSerializer


class ExpenseViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"GET": "expenses.view", "*": "expenses.create"}
    pagination_class = EnvelopePagination
    filter_backends = []
    queryset = Expense.objects.none()

    def get_queryset(self):
        user, p = self.request.user, self.request.query_params
        qs = Expense.objects.filter(organization=user.organization).select_related("created_by")
        if not has_perm(user, "expenses.view_all"):  # D10: a Barista sees their own only
            qs = qs.filter(created_by=user)
        for field in ("status", "category", "source", "type"):
            if p.get(field):
                qs = qs.filter(**{field: p[field]})
        if rng := parse_range(p, org_timezone(user.organization), default_today=False):
            qs = qs.filter(paid_at__gte=rng[2], paid_at__lt=rng[3])
        return qs

    @extend_schema(operation_id="expenses_list", responses=OpenApiTypes.OBJECT)
    def list(self, request):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([services.expense_dict(e) for e in page])

    @extend_schema(request=ExpenseCreateSerializer, responses={201: OpenApiTypes.OBJECT})
    def create(self, request):
        ser = ExpenseCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        exp = services.create_expense(request.user, ser.validated_data)
        return Response(services.expense_dict(exp), status=201)

    @extend_schema(request=ExpenseVoidSerializer, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], url_path="void")
    def void(self, request, pk=None):
        if not has_perm(request.user, "expenses.void"):
            raise PermissionDenied()
        ser = ExpenseVoidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        exp = services.void_expense(request.user, pk, ser.validated_data["reason"])
        return Response(services.expense_dict(exp))
