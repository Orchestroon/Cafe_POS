from rest_framework import serializers


class StrictSerializerMixin:
    """Reject keys that are not writable fields, so e.g. a balance can never be smuggled into an
    ingredient PATCH (spec 8.9)."""

    def to_internal_value(self, data):
        if isinstance(data, dict):
            writable = {n for n, f in self.fields.items() if not f.read_only}
            unknown = {k: "Unknown or read-only field." for k in data if k not in writable}
            if unknown:
                raise serializers.ValidationError(unknown)
        return super().to_internal_value(data)


class _StringDecimalField(serializers.DecimalField):
    """Money/quantities are JSON strings; numeric JSON is rejected (spec 5.1)."""

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


def MoneyField(**kw):
    kw.setdefault("min_value", 0)
    return _StringDecimalField(max_digits=12, decimal_places=2, **kw)


def QtyField(**kw):
    return _StringDecimalField(max_digits=14, decimal_places=3, **kw)


def CostField(**kw):
    return _StringDecimalField(max_digits=12, decimal_places=4, **kw)
