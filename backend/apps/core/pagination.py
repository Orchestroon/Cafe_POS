from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class EnvelopePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data):
        meta = {
            "page": self.page.number,
            "page_size": self.get_page_size(self.request),
            "total_count": self.page.paginator.count,
        }
        return Response({"data": data, "meta": meta})

    def get_paginated_response_schema(self, schema):
        return {"type": "object", "properties": {"data": schema, "meta": {"type": "object"}}}
