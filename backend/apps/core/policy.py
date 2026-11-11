"""The single place mapping named permissions to roles (spec 5.5, section 6)."""

ADMIN, BARISTA = "admin", "barista"
_BOTH = frozenset({ADMIN, BARISTA})
_ADMIN = frozenset({ADMIN})

PERMISSIONS: dict[str, frozenset[str]] = {
    "catalog.view": _BOTH,
    "catalog.manage": _ADMIN,
    "modifiers.view": _BOTH,
    "modifiers.manage": _ADMIN,
    "shifts.own": _BOTH,
    "sales.quote": _BOTH,
    "sales.checkout": _BOTH,
    "orders.view": _BOTH,
    "orders.view_all": _ADMIN,
    "recipes.manage": _ADMIN,
    "inventory.manage": _ADMIN,
    "users.manage": _ADMIN,
    "settings.view": _BOTH,
    "settings.manage": _ADMIN,
    "shifts.manage": _ADMIN,
    "refund.create": _BOTH,
    "ledgers.view": _ADMIN,
    "purchasing.manage": _ADMIN,
    "expenses.create": _BOTH,
    "expenses.view": _BOTH,
    "expenses.void": _ADMIN,
    "expenses.view_all": _ADMIN,
    "reports.view": _ADMIN,
    "audit.view": _ADMIN,
}


def has_perm(user, name: str) -> bool:
    return bool(
        user and user.is_authenticated and user.is_active and user.role in PERMISSIONS[name]
    )
