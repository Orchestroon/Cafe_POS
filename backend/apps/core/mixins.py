class TenantScopedViewSetMixin:
    """Every queryset is filtered by the caller's organization; creates stamp it (spec 5.2)."""

    def get_queryset(self):
        return super().get_queryset().filter(organization=self.request.user.organization)

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)
