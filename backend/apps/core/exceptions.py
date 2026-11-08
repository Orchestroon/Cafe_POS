import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import DataError, IntegrityError
from django.http import Http404
from rest_framework import exceptions as drf
from rest_framework.response import Response
from rest_framework.views import set_rollback

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """Domain error with a stable code, e.g. ApiError("LAST_ADMIN", "…", 422)."""

    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details or {}


def _body(code, message, details=None):
    return {"error": {"code": code, "message": str(message), "details": details or {}}}


def exception_handler(exc, context):
    if isinstance(exc, ApiError):
        status, body = exc.status, _body(exc.code, exc.message, exc.details)
    elif isinstance(exc, drf.ValidationError):
        fields = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
        status = 400
        body = _body("VALIDATION_ERROR", "Validation failed.", {"fields": fields})
    elif isinstance(exc, (drf.NotAuthenticated, drf.AuthenticationFailed)):
        status, body = 401, _body("NOT_AUTHENTICATED", "Authentication required.")
    elif isinstance(exc, (drf.PermissionDenied, DjangoPermissionDenied)):
        status, body = 403, _body("PERMISSION_DENIED", "You do not have permission.")
    elif isinstance(exc, (drf.NotFound, Http404)):
        status, body = 404, _body("NOT_FOUND", "Not found.")
    elif isinstance(exc, drf.Throttled):
        status, body = 429, _body("RATE_LIMITED", "Too many requests.")
    elif isinstance(exc, (IntegrityError, DataError, DjangoValidationError)):
        # Lost uniqueness race, numeric overflow or a malformed lookup value: bad input, not a 500.
        logger.warning("request rejected by the database: %s", type(exc).__name__)
        status, body = 400, _body("VALIDATION_ERROR", "Validation failed.")
    elif isinstance(exc, drf.APIException):
        status = exc.status_code
        body = _body(str(exc.default_code).upper(), exc.detail)
    else:
        logger.exception("unhandled error")
        return Response(_body("INTERNAL_ERROR", "Internal error."), status=500)

    set_rollback()
    response = Response(body, status=status)
    if isinstance(exc, drf.Throttled) and exc.wait:
        response["Retry-After"] = str(int(exc.wait))
    return response
