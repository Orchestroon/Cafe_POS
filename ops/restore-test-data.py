"""AT-23 helper: runs inside the backend container (manage.py shell). Builds a small café, makes
one sale through the HTTP API (the way the POS does), and prints the figures a restore must give
back: `RESTORE-CHECK <orders> <order total> <audit events> <stock movements> <users>`."""

import os
import uuid

from django.test import Client

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from apps.catalog.models import Category, Product, ProductVariant, RecipeLine
from apps.inventory.models import Ingredient, StockBalance, StockMovement
from apps.inventory.services import set_opening_balances
from apps.sales.models import Order
from apps.tenancy.models import Organization
from apps.tenancy.seed import default_location

org = Organization.objects.get()
admin = User.objects.filter(role="admin").first()
cat, _ = Category.objects.get_or_create(organization=org, name="Restore test")
prod, _ = Product.objects.get_or_create(organization=org, name="Test coffee", defaults={"category": cat})
var, _ = ProductVariant.objects.get_or_create(
    organization=org, product=prod, label="Cup", defaults={"price": "65.00"}
)
beans, _ = Ingredient.objects.get_or_create(organization=org, name="Test beans", defaults={"base_unit": "g"})
StockBalance.objects.get_or_create(organization=org, ingredient=beans, location=default_location(org))
RecipeLine.objects.get_or_create(organization=org, variant=var, ingredient=beans, defaults={"base_qty": "10.000"})
set_opening_balances(admin, [{"ingredient_id": beans.pk, "qty": "1000.000", "total_value": "500"}])

c = Client(HTTP_HOST=os.environ["ALLOWED_HOSTS"].split(",")[0])
c.force_login(admin)


def post(path, body):
    r = c.post(
        f"/api/v1/{path}",
        body,
        content_type="application/json",
        secure=True,
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert r.status_code in (200, 201), (path, r.status_code, r.content)
    return r.json()["data"]


post("shifts/open", {"opening_cash": "100.00"})
post(
    "orders/checkout",
    {
        "items": [{"variant_id": str(var.pk), "quantity": 1, "modifier_option_ids": []}],
        "payments": [{"method": "cash", "amount": "65.00"}],
        "expected_total": "65.00",
    },
)
total = Order.objects.order_by("-created_at").values_list("total", flat=True).first()
print(
    "RESTORE-CHECK",
    Order.objects.count(),
    total,
    AuditEvent.objects.count(),
    StockMovement.objects.count(),
    User.objects.count(),
)
