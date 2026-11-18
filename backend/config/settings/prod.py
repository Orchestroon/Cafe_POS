"""Production settings. The app sits behind the Caddy proxy (one hop), which ends HTTPS.
`python manage.py check --deploy` must stay free of warnings (a test runs it)."""

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS, MIDDLEWARE, SECRET_KEY, env

DEBUG = False

# Refuse to start with a weak or example configuration: better a clear error than a café running
# on a guessable key or answering every Host header.
if (
    len(SECRET_KEY) < 50
    or len(set(SECRET_KEY)) < 10
    or SECRET_KEY.lower().startswith(("django-insecure", "dev-only", "change-me", "e2e-only"))
):
    raise ImproperlyConfigured(
        "SECRET_KEY is too short or looks like an example. Generate one: "
        'python -c "import secrets; print(secrets.token_urlsafe(64))"'
    )
if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("ALLOWED_HOSTS must list the café's host name(s), never '*'.")
if not CSRF_TRUSTED_ORIGINS or any(not o.startswith("https://") for o in CSRF_TRUSTED_ORIGINS):
    raise ImproperlyConfigured(
        "CSRF_TRUSTED_ORIGINS must list https:// origins, e.g. https://pos.example.com"
    )

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
# The container healthcheck calls the app over plain http inside the network.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health$"]

# HSTS starts at one day so a mistake can be undone; raise it (e.g. 31536000) once HTTPS is proven.
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=86400)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=False)
SECURE_HSTS_PRELOAD = False
# Deliberate: no HSTS preload list (a one-way door). W005: the POS host may share its parent domain
# with sites that are not HTTPS yet, so subdomains are included only when the owner says so.
SILENCED_SYSTEM_CHECKS = ["security.W021"] + (
    [] if SECURE_HSTS_INCLUDE_SUBDOMAINS else ["security.W005"]
)

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
assert "django.middleware.clickjacking.XFrameOptionsMiddleware" in MIDDLEWARE
