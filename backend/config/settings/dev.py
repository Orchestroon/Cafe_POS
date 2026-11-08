from .base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "backend"]
CSRF_TRUSTED_ORIGINS = ["http://localhost:5173", "http://localhost:8000"]
