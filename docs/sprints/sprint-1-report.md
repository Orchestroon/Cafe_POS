# Sprint 1 report — Foundation and master data

Status: **finalized** (2026-11-08). Approved by the owner, audit fixes committed (`2bfc0f4`) and on `main`. CI on `main` confirmed passing by the owner (not re-checked by the assistant). Nothing is pending.

## What was built
**Backend** (Django 5.2 LTS, DRF, Postgres 16, Python 3.12 in Docker)
- **core:** `TenantModel`; `AppendOnlyModel` (rejects save-update, delete, queryset update/delete); `IdempotencyRecord` + `run_idempotent` (record inserted in the business transaction, replay with `Idempotent-Replayed`, 409 on a different payload, lost-race replay, rollback on failure); `policy.py` (named permissions → roles) + DRF `PolicyPermission`; tenant-scoped viewset mixin; envelope pagination (`page`, `page_size` ≤ 100); strict serializers (unknown/read-only keys rejected); decimal-string fields (numeric JSON rejected); `timeutils.local_date_range` (DST-safe, org timezone); JSON 404/403(CSRF) views; OpenAPI annotated (`/api/v1/schema/`, `/docs/` in non-prod, no warnings).
- **audit:** append-only `AuditEvent` + `record()`; refuses password/token/session keys.
- **tenancy:** `OrganizationSettings`, `Branch`, `Location`, `Register`; idempotent `seed_org`; `GET/PATCH /settings` (Admin full, Barista safe subset), changes audited with before/after.
- **accounts:** `GET /auth/csrf`, `POST /auth/login` (CSRF-protected, throttled 10/min per client IP and per username via **DatabaseCache**; the client IP is `REMOTE_ADDR` and `X-Forwarded-For` is ignored unless `NUM_PROXIES` is set), `POST /auth/logout`, `GET /auth/me`; `/users` list/create/PATCH, `/users/{id}/reset-password`; `LAST_ADMIN` rule (admin rows locked), no self-deactivation; deactivation and password reset kill live sessions; all audited.
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
| `pytest -q --tb=short` | **188 passed** (178 + 10 audit tests), coverage 99% |
| `spectacular` schema generation | no warnings or errors |
| `tsc --noEmit`, `eslint src`, `vite build` | pass |
| Browser run (headless Chrome vs. dev stack) | login, guards, category/product/size, opening balance, adjustment, ledger, user create/deactivate, settings, RTL: all pass; no horizontal overflow at 1280 / 820 / 390 px; no console errors besides expected 400s |
| CI workflow | passing on `main` (owner-confirmed, 2026-11-08) |

## Audit fixes (post-review, 2026-11-08)
A read-only code and security audit of Sprint 0–1 found 1 High and 5 Medium issues. All are fixed, and each fix has a test that fails without it.
- **High: the IP login throttle could be bypassed.** DRF's `NUM_PROXIES` was unset, so the client IP was read from the client-controlled `X-Forwarded-For` header and a forged value per request avoided the per-IP limit. The earlier claim in this report that throttling used `REMOTE_ADDR` was **wrong**. Now `NUM_PROXIES` comes from the environment (default `0` = always `REMOTE_ADDR`); set it to the number of trusted reverse proxies in production (`.env.example`).
- **LAST_ADMIN lock order:** `update_user` now locks the organization's active admins (by id) *before* the target row. Two admins deactivating each other at once no longer deadlock (500); one wins and the other gets 422 `LAST_ADMIN`.
- **Audited updates read a locked row:** settings, category/product/variant and ingredient updates re-read the row with `select_for_update` before computing the audit before/after, so concurrent edits (e.g. prices) record a consistent chain and do not lose updates. `PUT /products/{id}/modifier-groups` locks the product.
- **Database rejections are 400, not 500:** a lost uniqueness race (`IntegrityError`), a quantity overflowing `decimal(14,3)` (`DataError`) or a malformed lookup value (e.g. `?category_id=abc`) now return 400 `VALIDATION_ERROR`.
- **Self password reset** keeps the admin's current session (`update_session_auth_hash`); all their other sessions still end. Previously the admin was logged out (deviation 9).
- **New tests:** forged `X-Forwarded-For`; throttling on the real `DatabaseCache` (+ `createcachetable`); concurrent cross-deactivation of two admins; concurrent opening balances (one 201, one 409); a deactivated user's live session cannot write; balance overflow → 400; malformed filter → 400; lost uniqueness race → 400; concurrent price edits audit chain; self password reset.


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
9. (Audit fix) An admin resetting **their own** password stays logged in on the current session; their other sessions end. Resets of other users end all of that user's sessions, as before. **Approved by the owner (2026-11-08).**

## Known issues / limits
- Append-only is enforced in the ORM; raw SQL could still change rows (code comment `shortcut:`). Consider DB triggers or a restricted DB role in Sprint 5.
- Throttling identifies the client by `REMOTE_ADDR` (`NUM_PROXIES=0`). Behind a reverse proxy, set `NUM_PROXIES` to the number of trusted proxies, otherwise every request is counted under the proxy's IP (Sprint 5 deployment).
- A dev DB that already ran older throttling tests may show "too many attempts" for a minute.
- Pickers load all ingredients (max 100 per request, looped); fine for hundreds, revisit if thousands.
- Frontend has no unit tests (spec only requires tsc/lint/build for the frontend until Sprint 4 Playwright).
- `npm audit` advisories unreviewed.

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

## Owner decisions (2026-11-08)
1. **Approved:** Sprint 1 and deviations 1–9 (deviation 9 approved separately, 2026-11-08), effective once the audit fixes are committed and the incorrect "REMOTE_ADDR" claim is corrected (both done above).
2. **Sprint 2 order unchanged:** recipes + modifiers CRUD → pricing and consumption engines → quote → checkout (the lock/error issues are fixed first).
3. **Audit-log screen stays in Sprint 4.** Sprint 2 stays focused on selling; audit events are already being recorded.

## Handoff to the Sprint 2 developer
- **Before writing any Sprint 2 code:** confirm the owner's final business decisions on **printer, taxes, shifts and returns**, and update `docs/PROJECT_SPEC.md` (and §14 open items) to match. The spec wins over any plan, so Sprint 2 must not start from stale assumptions.
- **UI polish (from the owner's manual review):** consider adding a Save button at the bottom of the Settings page so admins do not have to scroll back up. Not a bug, not done in Sprint 1.
- Production: set `NUM_PROXIES` (see Audit fixes). Sprint 2 was not started by the Sprint 1 assistant.
