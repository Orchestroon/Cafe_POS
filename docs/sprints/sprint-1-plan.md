# Sprint 1 plan — Foundation and master data

Read: CLAUDE.md, PROGRESS.md, sprint-0-report, spec §5–§9, §10.1/10.6, §11. No blocker found; assumptions below.

## Assumptions / decisions (also go to the report's Deviations)
1. `ProductModifierGroup` needs `ModifierGroup`, which the spec delivers in Sprint 2. Sprint 1 adds the `modifiers` app with **only** `ModifierGroup` + `ProductModifierGroup` models (no group API/UI). `PUT /products/{id}/modifier-groups` works against groups created elsewhere; request body is a JSON array `[{group_id, sort_order}]` as in §9.3.
2. Recipes (`RecipeLine`, `/variants/{id}/recipe`) are Sprint 2 (§11).
3. Login throttling uses Django `DatabaseCache` (owner decision), 10/min per IP and per username.
4. Extra error code `CANNOT_DEACTIVATE_SELF` (422) for "an Admin cannot deactivate themselves" (§6 gives no code).
5. Ingredient `base_unit` is create-only (changing it with stock history would corrupt the ledger). Balance fields on ingredient POST/PATCH are rejected with `VALIDATION_ERROR` (all write serializers reject unknown keys).
6. Opening balance qty must be > 0. A count with delta 0 records a `StockAdjustment` but no movement (§8.9).
7. Barista `/settings` GET returns every field except `invoice_prefix`.
8. Session invalidation relies on Django's per-request `is_active` check and session-auth-hash (password change); both are tested.
9. Out of Sprint 1: audit-log UI/endpoint, invoice-prefix "sales exist" warning (no sales yet), recipes, modifiers admin.

## Backend
- [ ] 1 core: `TenantModel`, `AppendOnlyModel`, tenant mixin, pagination, strict serializers, decimal-string fields, policy, time utils
- [ ] 2 audit app: `AuditEvent` (append-only) + `record()`
- [ ] 3 core: idempotency module + unit tests
- [ ] 4 tenancy: Settings/Branch/Location/Register, idempotent `seed_org`, `/settings`
- [ ] 5 accounts: csrf/login(throttled, DatabaseCache)/logout/me, users CRUD, `LAST_ADMIN`, reset-password
- [ ] 6 catalog + modifiers stubs: categories, products, variants, modifier-group links
- [ ] 7 inventory: ingredients, balances, movements (append-only), adjustments, opening balances
- [ ] 8 `seed_demo`
- [ ] 9 tests: AT-01, parametrized permission test for every endpoint, tenancy isolation, auth/deactivation, ledger/stock, last admin
## Frontend
- [ ] 10 theme + shell ported from legacy (logical CSS), i18n `dir`, API client (CSRF, 401, errors)
- [ ] 11 login/logout, route guards, 403 page, responsive shell
- [ ] 12 admin: categories, products+variants, ingredients, balances, movements, adjustments, opening balances, users, settings
## Close
- [ ] 13 full §4.4 check suite, PROGRESS.md, sprint-1-report.md, STOP
