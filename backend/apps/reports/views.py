from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import PolicyPermission
from apps.core.timeutils import parse_range
from apps.sales.selectors import org_timezone

from .services import NO_PERSON_FILTER, REPORTS, TOP_PRODUCTS_LIMIT


def _uuid_param(params, name):
    import uuid

    if params.get(name):
        try:
            uuid.UUID(params[name])
        except ValueError:
            raise ValidationError({name: "Not a valid id."}) from None


class ReportView(APIView):
    """GET /reports/<name>?from=&to=&cashier_id=&shift_id= (Admin). Local dates (spec 5.7); with
    no dates the report covers today. `meta.range` echoes the resolved range."""

    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "reports.view"}
    report = ""

    def get(self, request):
        fn = REPORTS[self.report]
        org, p = request.user.organization, request.query_params
        _uuid_param(p, "cashier_id")
        _uuid_param(p, "shift_id")
        if self.report in NO_PERSON_FILTER:  # Q6 item 3A (owner, 2026-11-11)
            bad = {
                k: "This report has no cashier or shift filter."
                for k in ("cashier_id", "shift_id")
                if p.get(k)
            }
            if bad:
                raise ValidationError(bad)
        if p.get("ordering") not in (None, "", "qty", "revenue"):
            raise ValidationError({"ordering": "Use qty or revenue."})
        tz = org_timezone(org)
        d_from, d_to, lo, hi = parse_range(p, tz, default_today=True)
        meta = {
            "range": {
                "from": d_from.isoformat(),
                "to": d_to.isoformat(),
                "timezone": tz,
                "start_utc": lo.isoformat().replace("+00:00", "Z"),
                "end_utc": hi.isoformat().replace("+00:00", "Z"),
            }
        }
        data = fn(org, lo, hi, p)
        if self.report == "top-products":  # Q6 item 4A: say when rows were cut
            meta["limit"] = TOP_PRODUCTS_LIMIT
            meta["truncated"] = data.pop("truncated")
        return Response({"data": data, "meta": meta})


def _view(name):
    # One class per report so each gets its own OpenAPI operation id.
    class View(ReportView):
        report = name

        @extend_schema(
            operation_id="reports_" + name.replace("-", "_"), responses=OpenApiTypes.OBJECT
        )
        def get(self, request):
            return super().get(request)

    return View


REPORT_VIEWS = {name: _view(name) for name in REPORTS}
