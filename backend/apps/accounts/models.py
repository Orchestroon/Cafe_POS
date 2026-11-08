import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin"
        BARISTA = "barista"

    class Language(models.TextChoices):
        EN = "en"
        AR = "ar"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "tenancy.Organization", on_delete=models.PROTECT, related_name="users"
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.BARISTA)
    display_name = models.CharField(max_length=150, blank=True)
    preferred_language = models.CharField(max_length=2, choices=Language.choices, default="en")
