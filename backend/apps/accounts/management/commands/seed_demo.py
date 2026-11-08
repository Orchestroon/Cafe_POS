from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.catalog.models import Category, Product, ProductVariant
from apps.inventory.models import Ingredient, StockBalance
from apps.tenancy.seed import default_location, seed_organization

DEMO_PASSWORD = "Demo-pass-123"


class Command(BaseCommand):
    help = "DEV ONLY: demo users, Iced Latte (Small/Large/XL) and a few ingredients. Idempotent."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo is for development only (DEBUG must be on).")
        org = seed_organization()
        for username, role, name in [
            ("admin", "admin", "Demo Admin"),
            ("barista1", "barista", "Barista One"),
            ("barista2", "barista", "Barista Two"),
        ]:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={"organization": org, "role": role, "display_name": name},
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()

        cat, _ = Category.objects.get_or_create(organization=org, name="Cold Drinks")
        latte, _ = Product.objects.get_or_create(
            organization=org, name="Iced Latte", defaults={"category": cat}
        )
        for i, (label, price) in enumerate(
            [("Small", "65.00"), ("Large", "80.00"), ("XL", "95.00")]
        ):
            ProductVariant.objects.get_or_create(
                organization=org,
                product=latte,
                label=label,
                defaults={"price": price, "sort_order": i},
            )

        location = default_location(org)
        for name, unit in [
            ("Coffee Beans", "g"),
            ("Whole Milk", "ml"),
            ("Oat Milk", "ml"),
            ("Ice", "g"),
            ("Sugar Syrup", "ml"),
            ("Cups 12oz", "pcs"),
        ]:
            ing, _ = Ingredient.objects.get_or_create(
                organization=org, name=name, defaults={"base_unit": unit}
            )
            StockBalance.objects.get_or_create(organization=org, ingredient=ing, location=location)
        self.stdout.write(
            f"Demo data ready. Users admin/barista1/barista2, password {DEMO_PASSWORD}"
        )
