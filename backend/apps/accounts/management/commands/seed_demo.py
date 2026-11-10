from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.catalog.models import Category, Product, ProductVariant, RecipeLine
from apps.inventory.models import Ingredient, StockBalance, StockMovement
from apps.inventory.services import set_opening_balances
from apps.modifiers.models import (
    ModifierEffect,
    ModifierGroup,
    ModifierOption,
    ModifierOptionPrice,
    ProductModifierGroup,
)
from apps.tenancy.seed import default_location, seed_organization

DEMO_PASSWORD = "Demo-pass-123"


class Command(BaseCommand):
    help = "DEV ONLY: demo users, Iced Latte with recipes and modifiers, and stock. Idempotent."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo is for development only (DEBUG must be on).")
        org = seed_organization()
        admin = None
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
            if username == "admin":
                admin = user

        cat, _ = Category.objects.get_or_create(organization=org, name="Cold Drinks")
        latte, _ = Product.objects.get_or_create(
            organization=org, name="Iced Latte", defaults={"category": cat}
        )
        variants = {}
        for i, (label, price) in enumerate(
            [("Small", "65.00"), ("Large", "80.00"), ("XL", "95.00")]
        ):
            variants[label], _ = ProductVariant.objects.get_or_create(
                organization=org,
                product=latte,
                label=label,
                defaults={"price": price, "sort_order": i},
            )

        location = default_location(org)
        ingredients = {}
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
            ingredients[name] = ing
        self._recipes_and_modifiers(org, latte, variants, ingredients)
        self._opening_stock(admin, org, ingredients)
        self.stdout.write(
            f"Demo data ready. Users admin/barista1/barista2, password {DEMO_PASSWORD}"
        )

    def _recipes_and_modifiers(self, org, latte, variants, ing):
        o = {"organization": org}
        # Per-size recipes (only when the size has none yet, so an edited recipe is never reset).
        sizes = {"Small": ("12", "200"), "Large": ("18", "300"), "XL": ("22", "400")}
        for label, (coffee, milk) in sizes.items():
            v = variants[label]
            if RecipeLine.objects.filter(variant=v).exists():
                continue
            RecipeLine.objects.create(
                variant=v,
                ingredient=ing["Coffee Beans"],
                base_qty=coffee,
                waste_pct="5.00",
                slot_key="coffee",
                **o,
            )
            RecipeLine.objects.create(
                variant=v, ingredient=ing["Whole Milk"], base_qty=milk, slot_key="milk", **o
            )
            RecipeLine.objects.create(variant=v, ingredient=ing["Ice"], base_qty="100", **o)
            RecipeLine.objects.create(variant=v, ingredient=ing["Cups 12oz"], base_qty="1", **o)

        milk_g, created = ModifierGroup.objects.get_or_create(
            organization=org,
            name="Milk Type",
            defaults={
                "mode": "replace",
                "replacement_slot": "milk",
                "min_select": 0,
                "max_select": 1,
            },
        )
        if created:
            oat = ModifierOption.objects.create(
                group=milk_g, label="Oat Milk", price_delta="15.00", **o
            )
            ModifierOptionPrice.objects.create(
                option=oat, variant=variants["Large"], price_delta="20.00", **o
            )
            for label, qty in [("Small", "180"), ("Large", "250"), ("XL", "300")]:
                ModifierEffect.objects.create(
                    option=oat,
                    variant=variants[label],
                    ingredient=ing["Oat Milk"],
                    base_qty=qty,
                    **o,
                )
        extras, created = ModifierGroup.objects.get_or_create(
            organization=org,
            name="Extras",
            defaults={"mode": "add", "min_select": 0, "max_select": 3, "sort_order": 1},
        )
        if created:
            shot = ModifierOption.objects.create(
                group=extras, label="Extra Shot", price_delta="20.00", **o
            )
            ModifierEffect.objects.create(
                option=shot,
                variant=None,
                ingredient=ing["Coffee Beans"],
                base_qty="8",
                waste_pct="5.00",
                **o,
            )
            syrup = ModifierOption.objects.create(
                group=extras, label="Syrup", price_delta="10.00", sort_order=1, **o
            )
            ModifierEffect.objects.create(
                option=syrup, variant=None, ingredient=ing["Sugar Syrup"], base_qty="15", **o
            )
        for i, g in enumerate([milk_g, extras]):
            ProductModifierGroup.objects.get_or_create(
                organization=org, product=latte, group=g, defaults={"sort_order": i}
            )

    def _opening_stock(self, admin, org, ing):
        stock = {
            "Coffee Beans": "5000",
            "Whole Milk": "20000",
            "Oat Milk": "5000",
            "Ice": "30000",
            "Sugar Syrup": "2000",
            "Cups 12oz": "200",
        }
        items = [
            {"ingredient_id": ing[n].pk, "qty": q}
            for n, q in stock.items()
            if not StockMovement.objects.filter(organization=org, ingredient=ing[n]).exists()
        ]
        if items and admin:
            set_opening_balances(admin, items)
