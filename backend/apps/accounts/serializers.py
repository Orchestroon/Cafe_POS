from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.core.serializers import StrictSerializerMixin

from .models import User


def _validate_password(value, user=None):
    try:
        password_validation.validate_password(value, user)
    except DjangoValidationError as e:
        raise serializers.ValidationError(list(e.messages)) from None
    return value


class UserSerializer(serializers.ModelSerializer):
    """Never exposes the password hash."""

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "display_name",
            "role",
            "is_active",
            "preferred_language",
            "last_login",
            "date_joined",
        ]


class UserCreateSerializer(StrictSerializerMixin, serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    role = serializers.ChoiceField(choices=User.Role.choices)
    display_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate(self, attrs):
        _validate_password(attrs["password"], User(username=attrs["username"]))
        return attrs


class UserUpdateSerializer(StrictSerializerMixin, serializers.Serializer):
    display_name = serializers.CharField(max_length=150, allow_blank=True)
    role = serializers.ChoiceField(choices=User.Role.choices)
    is_active = serializers.BooleanField()
    preferred_language = serializers.ChoiceField(choices=User.Language.choices)


class ResetPasswordSerializer(StrictSerializerMixin, serializers.Serializer):
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_password(self, value):
        return _validate_password(value, self.context.get("target"))


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)
