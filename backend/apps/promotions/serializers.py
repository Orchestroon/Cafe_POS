from rest_framework import serializers

from apps.catalog.models import Category, ProductVariant
from apps.core.serializers import MoneyField, StrictSerializerMixin

from .models import Promotion

TIME = {"format": "%H:%M", "input_formats": ["%H:%M", "%H:%M:%S"]}


class SlotInputSerializer(StrictSerializerMixin, serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1, max_value=20)
    category_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    variant_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list, max_length=200
    )


class PromotionInputSerializer(StrictSerializerMixin, serializers.Serializer):
    """The whole promotion (a PATCH is merged with the stored one before it gets here)."""

    name = serializers.CharField(max_length=100)
    kind = serializers.ChoiceField(choices=Promotion.Kind.choices)
    is_active = serializers.BooleanField()
    auto_apply = serializers.BooleanField()
    scope = serializers.ChoiceField(choices=Promotion.Scope.choices, allow_blank=True)
    discount_type = serializers.ChoiceField(
        choices=Promotion.DiscountType.choices, allow_blank=True
    )
    discount_value = MoneyField(allow_null=True)
    variant_ids = serializers.ListField(child=serializers.UUIDField(), max_length=200)
    category_ids = serializers.ListField(child=serializers.UUIDField(), max_length=50)
    combo_price = MoneyField(allow_null=True)
    slots = SlotInputSerializer(many=True, max_length=6)
    starts_on = serializers.DateField(allow_null=True)
    ends_on = serializers.DateField(allow_null=True)
    days_of_week = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6), max_length=7
    )
    window_start = serializers.TimeField(allow_null=True, **TIME)
    window_end = serializers.TimeField(allow_null=True, **TIME)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("A name is required.")
        qs = Promotion.objects.filter(
            organization=self.context["request"].user.organization, name__iexact=value
        )
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A promotion with this name already exists.")
        return value

    def validate_days_of_week(self, value):
        return sorted(set(value))

    def _owned(self, model, ids, field):
        ids = list(dict.fromkeys(ids))
        found = set(
            model.objects.filter(
                organization=self.context["request"].user.organization, pk__in=ids
            ).values_list("pk", flat=True)
        )
        if found != set(ids):
            raise serializers.ValidationError({field: "Unknown item."})
        return ids

    def validate(self, a):
        err = {}
        if a["starts_on"] and a["ends_on"] and a["ends_on"] < a["starts_on"]:
            err["ends_on"] = "The end date is before the start date."
        if (a["window_start"] is None) != (a["window_end"] is None):
            err["window_end"] = "Set both the start and the end of the time window."
        elif a["window_start"] is not None and a["window_start"] == a["window_end"]:
            err["window_end"] = "The window must not start and end at the same time."
        if a["kind"] == "discount":
            if not a["scope"]:
                err["scope"] = "Choose what the discount applies to."
            if not a["discount_type"]:
                err["discount_type"] = "Choose percentage or fixed amount."
            v = a["discount_value"]
            if v is None or v <= 0:
                err["discount_value"] = "The discount must be greater than 0."
            elif a["discount_type"] == "percentage" and v > 100:
                err["discount_value"] = "A percentage can not be more than 100."
            if a["scope"] == "variant" and not a["variant_ids"]:
                err["variant_ids"] = "Choose at least one size."
            if a["scope"] == "category" and not a["category_ids"]:
                err["category_ids"] = "Choose at least one category."
            if a["scope"] != "variant" and a["variant_ids"]:
                err["variant_ids"] = "Sizes apply only to a size discount."
            if a["scope"] != "category" and a["category_ids"]:
                err["category_ids"] = "Categories apply only to a category discount."
            if a["combo_price"] is not None or a["slots"]:
                err["slots"] = "A discount has no combo parts."
        else:
            if a["combo_price"] is None:
                err["combo_price"] = "Set the combo price."
            if not a["slots"]:
                err["slots"] = "Add the parts of the combo."
            elif sum(s["quantity"] for s in a["slots"]) < 2:
                err["slots"] = "A combo needs at least 2 items."
            for s in a["slots"]:
                if s["category_id"] is None and not s["variant_ids"]:
                    err["slots"] = "Each part needs a category or at least one size."
            if a["scope"] or a["discount_type"] or a["discount_value"] is not None:
                err["scope"] = "A combo has no discount type."
            if a["variant_ids"] or a["category_ids"]:
                err["variant_ids"] = "A combo uses its parts, not a size list."
        if err:
            raise serializers.ValidationError(err)
        a["variant_ids"] = self._owned(ProductVariant, a["variant_ids"], "variant_ids")
        a["category_ids"] = self._owned(Category, a["category_ids"], "category_ids")
        for s in a["slots"]:
            s["variant_ids"] = self._owned(ProductVariant, s["variant_ids"], "slots")
            if s["category_id"] is not None:
                self._owned(Category, [s["category_id"]], "slots")
        return a
