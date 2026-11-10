from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import idempotency
from apps.core.pagination import EnvelopePagination
from apps.core.permissions import PolicyPermission
from apps.core.policy import has_perm
from apps.core.timeutils import parse_range

from . import presenters, selectors, services
from .checkout import place_order
from .models import Order, Payment, Refund
from .refunds import refund_order
from .serializers import CheckoutSerializer, QuoteSerializer, RefundSerializer


class QuoteView(APIView):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "sales.quote"}

    @extend_schema(request=QuoteSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = QuoteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(services.quote(request.user.organization, ser.validated_data["items"]))


class CheckoutView(APIView):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "sales.checkout"}

    @extend_schema(request=CheckoutSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request):
        key = idempotency.parse_key(request)
        ser = CheckoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        result = idempotency.run_idempotent(
            organization=request.user.organization,
            user=request.user,
            scope="checkout",
            key=key,
            payload=request.data,
            handler=lambda: place_order(request.user, data, key),
        )
        return Response(result.body, status=result.status, headers=result.headers())


class OrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"GET": "orders.view", "POST": "refund.create"}
    pagination_class = EnvelopePagination
    filter_backends = []
    queryset = (
        Order.objects.none()
    )  # real queryset: get_queryset() (also lets the schema type {id})

    def get_queryset(self):
        return selectors.list_orders(self.request.user, self.request.query_params)

    @extend_schema(operation_id="orders_list", responses=OpenApiTypes.OBJECT)
    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([presenters.order_summary(o) for o in page])

    def _order(self, pk):
        order = selectors.get_order(self.request.user, pk)
        if order is None:
            raise NotFound()
        return order

    @extend_schema(operation_id="orders_retrieve", responses=OpenApiTypes.OBJECT)
    def retrieve(self, request, *args, pk=None, **kwargs):
        admin = has_perm(request.user, "orders.view_all")
        return Response(presenters.order_detail(self._order(pk), admin=admin))

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"], url_path="receipt")
    def receipt(self, request, pk=None):
        return Response(presenters.receipt(self._order(pk)))

    @extend_schema(request=RefundSerializer, responses={201: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"], url_path="refunds")
    def refunds(self, request, pk=None):
        key = idempotency.parse_key(request)
        ser = RefundSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        result = idempotency.run_idempotent(
            organization=request.user.organization,
            user=request.user,
            scope=f"refund:{pk}",
            key=key,
            payload=request.data,
            handler=lambda: refund_order(request.user, pk, ser.validated_data, key),
        )
        return Response(result.body, status=result.status, headers=result.headers())


class _Ledger(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Admin-only read ledgers. Filters `from`/`to` are café-local dates on the record's date."""

    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "ledgers.view"}
    pagination_class = EnvelopePagination
    filter_backends = []
    date_field = "created_at"

    def filtered(self, params):
        raise NotImplementedError

    def ledger(self, request):
        org = request.user.organization
        qs = self.filtered(request.query_params)
        if rng := parse_range(
            request.query_params, selectors.org_timezone(org), default_today=False
        ):
            qs = qs.filter(**{f"{self.date_field}__gte": rng[2], f"{self.date_field}__lt": rng[3]})
        return self.paginate_queryset(qs)


class RefundLedgerView(_Ledger):
    queryset = Refund.objects.none()
    date_field = "created_at"

    def filtered(self, params):
        qs = (
            Refund.objects.filter(organization=self.request.user.organization)
            .select_related("order", "actor", "order__cashier")
            .prefetch_related("lines")
        )
        if actor := params.get("actor_id"):
            qs = qs.filter(actor_id=actor)
        if method := params.get("method"):
            qs = qs.filter(lines__method=method).distinct()
        return qs

    @extend_schema(operation_id="refunds_list", responses=OpenApiTypes.OBJECT)
    def list(self, request):
        page = self.ledger(request)
        return self.get_paginated_response([presenters.refund_row(r) for r in page])


class PaymentLedgerView(_Ledger):
    queryset = Payment.objects.none()
    date_field = "created_at"

    def filtered(self, params):
        qs = Payment.objects.filter(organization=self.request.user.organization).select_related(
            "order", "order__cashier"
        )
        if method := params.get("method"):
            qs = qs.filter(method=method)
        if shift := params.get("shift_id"):
            qs = qs.filter(shift_id=shift)
        return qs

    @extend_schema(operation_id="payments_list", responses=OpenApiTypes.OBJECT)
    def list(self, request):
        page = self.ledger(request)
        return self.get_paginated_response([presenters.payment_row(p) for p in page])
