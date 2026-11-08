# Sprint 1 report — Foundation and master data

Status: **ready for owner testing** (STOP).

## What was built
**Backend** (Django 5.2 LTS, DRF, Postgres 16, Python 3.12 in Docker)
- **core:** `TenantModel`; `AppendOnlyModel` (rejects save-update, delete, queryset update/delete); `IdempotencyRecord` + `run_idempotent` (record inserted in the business transaction, replay with `Idempotent-Replayed`, 409 on a different payload, lost-race replay, rollback on failure); `policy.py` (named permissions → roles) + DRF `PolicyPermission`; tenant-scoped viewset mixin; envelope pagination (`page`, `page_size` ≤ 100); strict serializers (unknown/read-only keys rejected); decimal-string fields (numeric JSON rejected); `timeutils.local_date_range` (DST-safe, org timezone); JSON 404/403(CSRF) views; OpenAPI annotated (`/api/v1/schema/`, `/docs/` in non-prod, no warnings).
- **audit:** append-only `AuditEvent` + `record()`; refuses password/token/session keys.
- **tenancy:** `OrganizationSettings`, `Branch`, `Location`, `Register`; idempotent `seed_org`; `GET/PATCH /settings` (Admin full, Barista safe subset), changes audited with before/after.
- **accounts:** `GET /auth/csrf`, `POST /auth/login` (CSRF-protected, throttled 10/min per IP and per username via **DatabaseCache**), `POST /auth/logout`, `GET /auth/me`; `/users` list/create/PATCH, `/users/{id}/reset-password`; `LAST_ADMIN` rule (admin rows locked), no self-deactivation; deactivation and password reset kill live sessions; all audited.
- **catalog:** categories, products (with variants and linked groups), `POST /products/{id}/variants`, `PATCH /variants/{id}`, `PUT /products/{id}/modifier-groups`. Barista sees only active category/product/size. Price changes audited before/after.
- **modifiers:** `ModifierGroup` and `ProductModifierGroup` models only (see Deviations).
- **inventory:** ingredients (auto `StockBalance` in the default location), `GET /inventory/balances` (`is_low`, `is_negative`, `search`), `GET /inventory/movements` (`ingredient_id`, `movement_type`, `from`, `to` in org-local dates), `POST /inventory/adjustments` (delta or count, reason mandatory, count delta computed under row lock), `POST /inventory/opening-balances` (all-or-nothing, 409 `OPENING_BALANCE_EXISTS`). Balance rows locked with `select_for_update` ordered by ingredient id.
- **`seed_demo`** (refuses when `DEBUG` is off): admin, barista1, barista2, Iced Latte (Small 65 / Large 80 / XL 95), 6 ingredients.

**Frontend** (Vite + React 18 + TS)
- Theme, colors, typography and layout shell ported from `legacy/css/style.css` (filtered to the shell/components; physical left/right converted to logical properties; RTL transform overrides in `rtl.css`). No legacy JS was read or copied.
- API client (CSRF, envelope unwrap, error parsing, 401 → logged-out state), `react-i18next` (`en.json` complete, `ar.json` skeleton with identical keys), `<html lang dir>` handling, EN/عربي toggle, formatting helper.
- Login/logout, route guards (anonymous → `/login`, barista on `/admin/*` → 403 page), responsive shell (sidebar, drawer, top bar, mobile bottom nav).
- Admin: categories; products with inline sizes table; ingredients; inventory (balances with low/negative highlight, movements ledger with filters, adjustment form, opening-balances bulk form); users (create, edit, reset password, deactivate/reactivate); settings.
- Every list/mutation has loading, error (translated code) and empty states.

## Test and check results (local)
| Check | Result |
|---|---|
| `ruff check` / `ruff format --check` | pass |
| `makemigrations --check --dry-run` | no changes |
| `pytest -q --tb=short` | **178 passed**, coverage 99% |
| `spectacular` schema generation | no warnings or errors |
| `tsc --noEmit`, `eslint src`, `vite build` | pass |
| Browser run (headless Chrome vs. dev stack) | login, guards, category/product/size, opening balance, adjustment, ledger, user create/deactivate, settings, RTL: all pass; no horizontal overflow at 1280 / 820 / 390 px; no console errors besides expected 400s |
| CI workflow | unchanged, **not run** (not pushed) |

Test map: AT-01 (`catalog/tests`); permission matrix with a guard that fails if a route is not listed (`core/tests/test_permissions_matrix.py`: anonymous 401, barista 403 with no side effects); two-organization isolation (lists, detail, mutations, cross-org references); auth (deactivated login, live-session rejection, password-reset invalidation, throttling, CSRF); ledger (append-only, reason required, count delta, opening balance rules, ingredient PATCH rejecting balance fields, DB constraints); last admin; idempotency unit tests; concurrent adjustments (4 threads, fails without the row lock — verified by removing it).

## Deviations from the spec (all also in PROGRESS.md)
1. `ModifierGroup` + `ProductModifierGroup` models exist in Sprint 1 only so the product↔group link can exist; no group API/UI (Sprint 2).
2. `PUT /products/{id}/modifier-groups` body is a JSON array `[{group_id, sort_order}]` (as §9.3 reads).
3. New error code `CANNOT_DEACTIVATE_SELF` (422) for §6 "an Admin cannot deactivate themselves".
4. Ingredient `base_unit` is create-only; all write serializers reject unknown keys (so balance fields on ingredient POST/PATCH → `VALIDATION_ERROR`).
5. Opening-balance qty must be > 0; zero-delta counts create an adjustment record but no movement (§8.9).
6. Barista `/settings` omits only `invoice_prefix`.
7. Backend runs in Docker only (Python 3.12); host ports 5433 (DB) and `BACKEND_PORT` for Django.
8. Audit-log screen/endpoint and the invoice-prefix "sales exist" warning are not in Sprint 1.

## Known issues / limits
- Append-only is enforced in the ORM; raw SQL could still change rows (code comment `shortcut:`). Consider DB triggers or a restricted DB role in Sprint 5.
- Throttling uses REMOTE_ADDR; behind a proxy set the forwarded-for handling (`NUM_PROXIES`) in Sprint 5.
- A dev DB that already ran older throttling tests may show "too many attempts" for a minute.
- Pickers load all ingredients (max 100 per request, looped); fine for hundreds, revisit if thousands.
- Frontend has no unit tests (spec only requires tsc/lint/build for the frontend until Sprint 4 Playwright).
- CI not yet verified on GitHub. `npm audit` advisories unreviewed.

## Owner manual test checklist
Start: `docker compose up -d --wait db`, `docker compose --profile backend up -d --wait backend`, `docker compose exec backend sh -c "python manage.py migrate && python manage.py seed_demo"`, `cd frontend && npm install && npm run dev` (use `BACKEND_PORT` / `VITE_API_TARGET` if 8000 is busy). Logins: `admin`, `barista1`, `barista2`; password `Demo-pass-123`.
- [ ] Log in as admin and as barista. The barista cannot reach admin pages (403 page) or call admin APIs (try `/api/v1/users` while logged in as barista → 403).
- [ ] Create a category, a product and 3 sizes with different prices. Deactivate a size (barista no longer sees it).
- [ ] Create ingredients in g, ml and pcs. Enter opening balances. Do an adjustment and a physical count. See the movements ledger.
- [ ] Create, deactivate and reactivate a user. A deactivated user cannot log in; an already logged-in deactivated user is logged out on the next click.
- [ ] Reset a user's password: that user's other sessions end.
- [ ] Try to demote/deactivate the last admin (blocked) and to deactivate yourself (blocked).
- [ ] Settings: change business name, tax rate, paper width; reload and see them kept; invalid tax rate (e.g. 150) is rejected.
- [ ] The app looks right on phone, tablet and desktop widths; toggle EN/عربي and see the layout mirror.
- [ ] Extra: wrong password 11 times in a minute → "Too many attempts".
- [ ] Extra: second opening balance for the same ingredient → blocked with a clear message.

## Questions for the owner
1. Approve Sprint 1 and the deviations above?
2. Sprint 2 needs `RecipeLine`, modifiers CRUD and checkout. Any change to the order of work?
3. Do you want an audit-log screen earlier than Sprint 4 (the data is already being recorded)?
