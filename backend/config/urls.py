from django.conf import settings
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import json_404

handler404 = json_404

urlpatterns = [path("api/v1/", include("apps.core.urls"))]

# OpenAPI schema and docs are served in non-production only.
if settings.DEBUG:
    urlpatterns += [
        path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    ]
