import django_filters as df
from django.db.models import F, Q

from apps.core.timeutils import local_date_range, parse_local_date
from apps.tenancy.models import OrganizationSettings

from .models import StockBalance, StockMovement


class BalanceFilter(df.FilterSet):
    is_low = df.BooleanFilter(method="f_low")
    is_negative = df.BooleanFilter(method="f_neg")
    search = df.CharFilter(field_name="ingredient__name", lookup_expr="icontains")

    class Meta:
        model = StockBalance
        fields = []

    def f_low(self, qs, name, value):
        cond = Q(
            ingredient__low_stock_threshold__isnull=False,
            qty__lte=F("ingredient__low_stock_threshold"),
        )
        return qs.filter(cond) if value else qs.exclude(cond)

    def f_neg(self, qs, name, value):
        return qs.filter(qty__lt=0) if value else qs.filter(qty__gte=0)


class MovementFilter(df.FilterSet):
    ingredient_id = df.UUIDFilter(field_name="ingredient_id")
    movement_type = df.ChoiceFilter(choices=StockMovement.Type.choices)
    # Local dates in the organization's timezone (spec 5.7); resolved in `filter_queryset`.
    # `from` is a Python keyword, so the filters are declared with their query-param names.
    from_ = df.CharFilter(method=lambda qs, n, v: qs)
    to = df.CharFilter(method=lambda qs, n, v: qs)

    class Meta:
        model = StockMovement
        fields = []

    @property
    def qs(self):
        qs = super().qs
        data = self.data
        d_from, d_to = data.get("from"), data.get("to")
        if d_from or d_to:
            tz = OrganizationSettings.objects.get(
                organization=self.request.user.organization
            ).timezone
            start = parse_local_date(d_from, "from") if d_from else None
            end = parse_local_date(d_to, "to") if d_to else None
            lo, _ = local_date_range(start or end, start or end, tz)
            _, hi = local_date_range(end or start, end or start, tz)
            if start:
                qs = qs.filter(occurred_at__gte=lo)
            if end:
                qs = qs.filter(occurred_at__lt=hi)
        return qs
