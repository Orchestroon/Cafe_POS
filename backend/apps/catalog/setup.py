"""Product setup: one product with its sizes, their recipes and its modifier links, read and saved
in ONE transaction (owner, 2026-11-16: the Products & recipes screen has a single Save button and
must never leave half the changes saved).

It reuses the existing building blocks, so the rules, locks and audit events are exactly those of
the separate endpoints: product.created/updated, variant.created/updated, recipe.replaced,
product.modifier_groups_replaced. Sizes are never deleted here (deactivate only, spec 5.4)."""

from django.db import transaction
from rest_framework import serializers

from apps.core.audited import create_obj, update_obj
from apps.core.exceptions import ApiError
from apps.core.serializers import StrictSerializerMixin

from . import services
from .models import Product, ProductVariant
from .serializers import (
    ModifierLinkSerializer,
    ProductSerializer,
    RecipeLineInputSerializer,
    VariantSerializer,
)

PRODUCT_FIELDS = ["category_id", "name", "description", "sort_order", "is_active"]
VARIANT_FIELDS = ["label", "sku", "price", "sort_order", "is_active", "track_stock"]
_VARIANT_INPUT = {"label", "sku", "price", "sort_order", "is_active", "track_stock"}


class SetupInputSerializer(StrictSerializerMixin, serializers.Serializer):
    """Shape only; every part is validated by the existing serializers in `save_setup`."""

    product = serializers.DictField()
    variants = serializers.ListField(child=serializers.DictField(), max_length=50)
    modifier_groups = serializers.ListField(
        child=serializers.DictField(), required=False, max_length=50
    )


def _invalid(details):
    return ApiError("VALIDATION_ERROR", "Validation failed.", 400, details)


def _check(ser, where):
    """Run a serializer; on failure point at the part of the screen (product or size n)."""
    if not ser.is_valid():
        raise _invalid({**where, "fields": ser.errors})
    return ser


def _variant_error(index, exc: ApiError):
    """Re-raise a recipe/size error with the size it belongs to, so the screen can show it."""
    return ApiError(exc.code, exc.message, exc.status, {**exc.details, "variant_index": index})


@transaction.atomic
def save_setup(actor, product, data, request):
    """Create (product=None) or update a product with its sizes, recipes and modifier links.
    Any error rolls everything back. Returns the product."""
    shape = _check(SetupInputSerializer(data=data), {})
    data = shape.validated_data
    ctx = {"request": request}

    # 1. The product (row locked by update_obj, which also serializes two concurrent setups).
    pser = _check(
        ProductSerializer(product, data=data["product"], partial=product is not None, context=ctx),
        {"part": "product"},
    )
    if product is None:
        product = create_obj(actor, pser, "product.created", PRODUCT_FIELDS)
    else:
        product = update_obj(actor, pser, "product.updated")

    # 2. Sizes and their recipes, in the order shown on the screen.
    rows = data["variants"]
    existing = {str(v.pk): v for v in ProductVariant.objects.filter(product=product)}
    if not rows and not existing:
        raise _invalid({"part": "variants", "fields": {"variants": "Add at least one size."}})
    labels = [str(r.get("label", "")).strip().lower() for r in rows if r.get("label")]
    if len(labels) != len(set(labels)):
        raise _invalid(
            {"part": "variants", "fields": {"variants": "Two sizes have the same name."}}
        )
    for i, row in enumerate(rows):
        where = {"part": "variant", "variant_index": i}
        unknown = set(row) - _VARIANT_INPUT - {"id", "recipe"}
        if unknown:
            raise _invalid({**where, "fields": {k: "Unknown or read-only field." for k in unknown}})
        vid = str(row["id"]) if row.get("id") else None
        inst = existing.get(vid) if vid else None
        if vid and inst is None:  # another product's or another café's size: never touched
            raise _invalid({**where, "fields": {"id": "Unknown size for this product."}})
        fields = {k: v for k, v in row.items() if k in _VARIANT_INPUT}
        vser = _check(
            VariantSerializer(
                inst,
                data=fields,
                partial=inst is not None,
                context={"request": request, "product": product},
            ),
            where,
        )
        recipe = None
        if row.get("recipe") is not None:
            lser = RecipeLineInputSerializer(data=row["recipe"], many=True)
            if not lser.is_valid():
                raise _invalid({**where, "part": "recipe", "fields": {"recipe": lser.errors}})
            recipe = lser.validated_data
        tracked = vser.validated_data.get("track_stock", inst.track_stock if inst else True)
        try:
            if not tracked and recipe:  # B3: "No stock tracking" keeps an empty recipe
                raise ApiError(
                    "INVALID_RECIPE",
                    "This size is set to no stock tracking. Turn tracking on to add a recipe.",
                    422,
                    {"lines": [], "reason": "stock_not_tracked"},
                )
            if inst is None:
                variant = create_obj(
                    actor, vser, "variant.created", VARIANT_FIELDS, product=product
                )
            else:
                if not tracked and recipe is not None:
                    services.replace_recipe(actor, inst, [])  # clear first, then the flag (B3)
                variant = services.update_variant(actor, vser)
            if tracked and recipe is not None:
                services.replace_recipe(actor, variant, recipe)
        except ApiError as exc:
            raise _variant_error(i, exc) from None

    # 3. Modifier links (optional; absent = unchanged).
    if "modifier_groups" in data:
        links = ModifierLinkSerializer(data=data["modifier_groups"], many=True)
        if not links.is_valid():
            raise _invalid({"part": "modifier_groups", "fields": {"modifier_groups": links.errors}})
        services.replace_modifier_groups(actor, product, links.validated_data)
    return product


def setup_payload(product, request) -> dict:
    """Everything the editor needs in one read: the product, every size (active or not) with its
    recipe and warnings, and the linked modifier groups."""
    product = Product.objects.select_related("category").get(pk=product.pk)
    ctx = {"request": request}
    data = dict(ProductSerializer(product, context=ctx).data)
    variants = list(ProductVariant.objects.filter(product=product))
    data["variants"] = [
        {**VariantSerializer(v, context=ctx).data, "recipe": services.recipe_payload(v)}
        for v in variants
    ]
    return data
