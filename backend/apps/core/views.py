from django.db import connection
from django.http import JsonResponse
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    """Liveness + DB check. Exposes no versions or secrets."""
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        return Response({"status": "ok", "db": "ok"})
    except Exception:
        return Response({"data": {"status": "error", "db": "error"}}, status=503)


def json_404(request, exception=None):
    body = {"error": {"code": "NOT_FOUND", "message": "Not found.", "details": {}}}
    return JsonResponse(body, status=404)


def csrf_failure(request, reason=""):
    body = {"error": {"code": "PERMISSION_DENIED", "message": "CSRF check failed.", "details": {}}}
    return JsonResponse(body, status=403)
