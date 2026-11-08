import uuid

from django.db import models


class Organization(models.Model):
    """Not tenant-owned. Pulled into Sprint 0 only because the custom User needs the FK in the
    very first migration; settings, branches etc. follow in Sprint 1."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
