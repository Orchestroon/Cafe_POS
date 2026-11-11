from .base import *  # noqa: F403
from .base import env

DEBUG = True
# EXTRA_* let the e2e stack (docker-compose.e2e.yml) reach the dev server as http://frontend:5173.
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "backend", *env.list("EXTRA_ALLOWED_HOSTS", default=[])]
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:8000",
    *env.list("EXTRA_CSRF_TRUSTED_ORIGINS", default=[]),
]
