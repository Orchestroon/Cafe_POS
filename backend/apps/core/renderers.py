from rest_framework.renderers import JSONRenderer


class EnvelopeJSONRenderer(JSONRenderer):
    """Wraps success payloads as {"data", "meta"}. Errors are already {"error"} (see exceptions)."""

    def render(self, data, accepted_media_type=None, renderer_context=None):
        response = (renderer_context or {}).get("response")
        passthrough = (
            data is None
            or response is None
            or response.exception
            or response.status_code >= 400
            or self._is_enveloped(data)
        )
        if not passthrough:
            data = {"data": data, "meta": {}}
        return super().render(data, accepted_media_type, renderer_context)

    @staticmethod
    def _is_enveloped(data):
        # Paginators return {"data", "meta"} themselves.
        return isinstance(data, dict) and "data" in data and set(data) <= {"data", "meta"}
