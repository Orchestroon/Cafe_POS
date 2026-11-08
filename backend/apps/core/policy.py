"""The single place mapping named permissions to roles (spec 5.5, section 6)."""

ADMIN, BARISTA = "admin", "barista"
_BOTH = frozenset({ADMIN, BARISTA})
_ADMIN = frozenset({ADMIN})

PERMISSIONS: dict[str, frozenset[str]] = {
    "catalog.view": _BOTH,
    "catalog.manage": _ADMIN,
    "inventory.manage": _ADMIN,
    "users.manage": _ADMIN,
    "settings.view": _BOTH,
    "settings.manage": _ADMIN,
}


def has_perm(user, name: str) -> bool:
    return bool(
        user and user.is_authenticated and user.is_active and user.role in PERMISSIONS[name]
    )
