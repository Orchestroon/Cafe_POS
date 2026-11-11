"""GET /audit-events (Admin, spec 9.3): read-only, newest first, café-local `from`/`to` dates."""

import re
import uuid
from zoneinfo import ZoneInfo

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.exceptions import ValidationError

from apps.core.pagination import EnvelopePagination
from apps.core.permissions import PolicyPermission
from apps.core.timeutils import parse_range
from apps.sales.selectors import org_timezone

from .models import AuditEvent

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _collect_ids(obj, out):
    if isinstance(obj, str) and _UUID.match(obj):
        out.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect_ids(v, out)
    elif isinstance(obj, list | tuple):
        for v in obj:
            _collect_ids(v, out)


def _person(u):
    return u.display_name or u.username


def _resolvers(tz):
    """(model, select_related, label) for every record an audit event can point at. Read-only;
    a fixed number of queries per page (one per model that still has unresolved ids)."""
    from apps.accounts.models import User
    from apps.catalog.models import Category, Product, ProductVariant
    from apps.expenses.models import Expense
    from apps.inventory.models import Ingredient, StockAdjustment
    from apps.modifiers.models import ModifierGroup, ModifierOption
    from apps.purchasing.models import Purchase, Supplier
    from apps.sales.models import Order, Refund
    from apps.shifts.models import CashierShift
    from apps.tenancy.models import OrganizationSettings

    zone = ZoneInfo(tz)
    return [
        (Order, (), lambda o: o.invoice_no),
        (Refund, ("order",), lambda r: r.order.invoice_no),
        (User, (), _person),
        (Ingredient, (), lambda i: i.name),
        (ProductVariant, ("product",), lambda v: f"{v.product.name} ({v.label})"),
        (Product, (), lambda p: p.name),
        (Category, (), lambda c: c.name),
        (ModifierGroup, (), lambda g: g.name),
        (ModifierOption, ("group",), lambda o: f"{o.group.name}: {o.label}"),
        (
            CashierShift,
            ("user",),
            lambda s: f"{_person(s.user)} · {s.opened_at.astimezone(zone):%Y-%m-%d %H:%M}",
        ),
        (StockAdjustment, ("ingredient",), lambda a: a.ingredient.name),
        (
            Purchase,
            ("supplier",),
            lambda p: " · ".join(
                x
                for x in (
                    p.supplier.name if p.supplier_id else "",
                    p.supplier_invoice_no,
                    p.purchased_on.isoformat(),
                )
                if x
            ),
        ),
        (Expense, (), lambda e: e.description),
        (Supplier, (), lambda s: s.name),
        (OrganizationSettings, (), lambda s: "settings"),
    ]


def resolve_names(org, ids, tz) -> dict:
    """{id: readable name} for the ids that still exist in this café (other cafés never match)."""
    names, todo = {}, set(ids)
    for model, related, label in _resolvers(tz):
        if not todo:
            break
        rows = model.objects.filter(organization=org, pk__in=todo)
        if related:
            rows = rows.select_related(*related)
        for row in rows:
            names[str(row.pk)] = label(row)
        todo -= set(names)
    return names


def _uuid(params, name):
    value = params.get(name)
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise ValidationError({name: "Not a valid id."}) from None


def event_row(e, names=None) -> dict:
    actor = None
    if e.actor_id:
        actor = {
            "id": str(e.actor_id),
            "username": e.actor.username,
            "display_name": e.actor.display_name or e.actor.username,
        }
    return {
        "id": str(e.pk),
        "created_at": e.created_at.isoformat().replace("+00:00", "Z"),
        "action": e.action,
        "entity_type": e.entity_type,
        "entity_id": str(e.entity_id),
        "entity_label": (names or {}).get(str(e.entity_id)),
        "actor": actor,
        "summary": e.summary,
    }


class AuditEventViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [PolicyPermission]
    permissions_by_method = {"*": "audit.view"}
    pagination_class = EnvelopePagination
    filter_backends = []
    queryset = AuditEvent.objects.none()

    @extend_schema(operation_id="audit_events_list", responses=OpenApiTypes.OBJECT)
    def list(self, request):
        org, p = request.user.organization, request.query_params
        qs = AuditEvent.objects.filter(organization=org).select_related("actor")
        if action := (p.get("action") or "").strip():
            qs = qs.filter(action=action)
        if entity_type := (p.get("entity_type") or "").strip():
            qs = qs.filter(entity_type=entity_type)
        if actor := _uuid(p, "actor_id"):
            qs = qs.filter(actor_id=actor)
        if entity := _uuid(p, "entity_id"):
            qs = qs.filter(entity_id=entity)
        if rng := parse_range(p, org_timezone(org), default_today=False):
            qs = qs.filter(created_at__gte=rng[2], created_at__lt=rng[3])
        page = self.paginate_queryset(qs.order_by("-created_at", "-id"))
        # Readable names for the records and the ids inside the summaries (non-technical viewer).
        ids = set()
        for e in page:
            ids.add(str(e.entity_id))
            _collect_ids(e.summary, ids)
        names = resolve_names(org, ids, org_timezone(org))
        response = self.get_paginated_response([event_row(e, names) for e in page])
        response.data["meta"]["names"] = names
        # The filter choices that exist in this café (small, distinct; for the viewer's dropdowns).
        base = AuditEvent.objects.filter(organization=org)
        response.data["meta"]["actions"] = sorted(set(base.values_list("action", flat=True)))
        response.data["meta"]["entity_types"] = sorted(
            set(base.values_list("entity_type", flat=True))
        )
        return response
