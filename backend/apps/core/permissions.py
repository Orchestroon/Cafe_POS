from rest_framework.permissions import BasePermission

from .policy import has_perm


class PolicyPermission(BasePermission):
    """The view declares `permissions_by_method = {"GET": "catalog.view", "*": "catalog.manage"}`.
    A method with no entry and no "*" is denied."""

    def has_permission(self, request, view):
        mapping = view.permissions_by_method
        name = mapping.get(request.method) or mapping.get("*")
        return bool(name) and has_perm(request.user, name)
