# Drip Café POS — Build Specification for Claude Code

**Spec version:** 1.1 (supersedes SRS v1.0 dated 2026-11-03 wherever they differ)
**Date:** 2026-11-08
**Place this file at:** `docs/PROJECT_SPEC.md` in the repository.
**Language of the codebase and docs:** English.

---

## 0. How to work with this document (read first, every session)

You are the implementer of this project. The human owner reviews, tests and approves each sprint.

### 0.1 Working protocol

1. **At the start of every session**, read `docs/PROJECT_SPEC.md` (this file) and `docs/PROGRESS.md`. `PROGRESS.md` is the single source of truth for what is done, what is in progress and what is next.
2. **Work on exactly one sprint at a time** (Section 11). Never start the next sprint without explicit approval from the owner in chat.
3. **Before coding a sprint**, write `docs/sprints/sprint-N-plan.md`: a checklist of tasks derived from Section 11, any assumptions, and any questions. If something blocks you, ask before coding.
4. **While coding:**
   - Commit after each coherent task using Conventional Commits (`feat(sales): atomic checkout`, `test(inventory): concurrent deduction`).
   - Run the relevant tests after each task.
   - Tick the task in the sprint plan file.
5. **At the end of a sprint:**
   - Run the full check suite (Section 4.4).
   - Update `docs/PROGRESS.md`.
   - Write `docs/sprints/sprint-N-report.md` containing:
     - what was built;
     - test results;
     - deviations from the spec and why;
     - known issues;
     - the **manual test checklist** for the owner (copy it from Section 11 and extend it).
   - Then **STOP** and tell the owner the sprint is ready for testing.
6. **Never silently change a decision in this spec.** If the spec is ambiguous, contradictory, or conflicts with the existing code, ask the owner. If you must proceed, choose the safest option and record it under "Deviations" in the sprint report.
7. **Never implement items listed as Out of scope or Later** (Section 3) unless the owner asks.
8. Items marked **[DEFAULT — confirm]** are implemented as described but must be easy to change. Prefer a settings flag or an isolated function.
9. **If a fix for an owner-reported bug changes behavior defined here**, update this spec in the same commit and note it in `PROGRESS.md`.

### 0.2 Sprint 0 creates these files

- `CLAUDE.md` at the repo root, containing at least:
  ```
  Before any work, read docs/PROJECT_SPEC.md and docs/PROGRESS.md.
  Work one sprint at a time and stop for owner approval at the end of each sprint.
  ```
- `docs/PROGRESS.md`, using this template:
  ```
  # Progress
  Current sprint: N — <name> — status: planning | in progress | awaiting owner test | approved
  ## Done
  ## In progress
  ## Next
  ## Open questions for owner
  ## Deviations from spec (cumulative)
  ```

---

## 1. Product summary

Drip Café needs a web-based **POS for day-to-day sales**, not a demo.

**The core sale loop:**
1. A cashier selects products, sizes and modifiers.
2. The server prices the order.
3. The cashier takes cash, card (on an external terminal), or both.
4. A receipt is printed.
5. The system deducts ingredients from stock based on recipes.

**Around that loop:**
- Shifts per cashier
- Purchases (stock receiving)
- Expenses
- Audited refunds
- Operational reports

**Operating context:**
- One branch and one warehouse (stock location).
- About 5 users with two fixed roles:
  - **Admin**
  - **Barista**, who is also the cashier.
- About 18–20 products, each with size variants.
- Counter sales only: dine-in and takeaway are the same flow. There are no tables and no delivery.
- **Online only.**
- **Responsive:** the same web app must work on phone, tablet and PC.

**Long-term direction:** the product will later become a multi-tenant **SaaS** sold to several cafés. v1 serves one café, but the data model must be tenant-ready from day one (Section 5.2).

---

## 2. Decisions log (v1.1)

| # | Topic | Decision | Status |
|---|---|---|---|
| D1 | Offline mode / sync | Deferred. Online-only. Never queue sales locally. | Final |
| D2 | Devices | One responsive web app (phone, tablet, PC). No native app. | Final |
| D3 | Scope | Client accepted the POS MVP scope below. No full ERP, multi-branch, warehouse transfers or Events module in v1. | Final |
| D4 | Warehouses | One stock location. A `Location` table exists with one default row (tenant-ready). | Final |
| D5 | Roles | Fixed roles `admin` and `barista`. No custom roles in v1. Permission checks go through one central policy layer so custom roles can be added later. | Final |
| D6 | SaaS foundation | Add `Organization`, `Branch`, `Location`, `Register` and `OrganizationSettings` now, each seeded with one row. All tenant-owned tables carry `organization_id`. No onboarding, billing or subdomains in v1. | Final |
| D7 | Shifts | **Per user.** Each barista opens and closes their own shift and is accountable for their own cash, even though the physical drawer is shared. One open shift per user at a time. Checkout requires the cashier's own open shift. | Final |
| D8 | Refunds | Any Admin or Barista can refund any paid order. Full refunds only. Reason is mandatory. Fully audited (who, when, which invoice, why, amounts). No extra approval step. **Confirmed by the owner (2026-11-10).** | Final |
| D9 | Refund of mixed-payment orders | Refund is allocated back to the original payment methods and amounts automatically. **Confirmed by the owner (2026-11-10).** | Final |
| D10 | Drawer expenses | A Barista can record an expense paid from the drawer against their own open shift. Admins can record any expense. **Confirmed by the owner (2026-11-10).** | Final |
| D11 | Tax | Optional per organization: `tax_enabled`, `tax_rate`, `prices_include_tax`, `tax_label`, `tax_registration_number`. When enabled, the receipt shows the tax breakdown. Government e-receipt integration is out of scope. **Owner (2026-11-10): tax stays off until the Admin turns it on and types the rate; when on, it is added on top of menu prices (`prices_include_tax=False` by default).** | Final |
| D12 | Language | English UI first. i18n infrastructure (translation keys) and RTL-ready CSS from day one. **Arabic translation written in Sprint 4 (owner, 2026-11-10); the owner reviews the wording.** `npm run i18n:check` fails on any missing or empty Arabic text. The Arabic UI uses the **Cairo** font (owner, 2026-11-11). | Final |
| D13 | Printing | A Print button opens the browser print flow on any printer the device has (USB, Bluetooth or network, configured at OS level). Receipt layouts for thermal paper widths **58, 76, 80 and 112 mm** plus A4. The width is chosen per device (each device remembers the width of its printer; Settings holds the default). The browser cannot detect the printer's paper, so there is no auto-detection. Silent printing not required. **Confirmed by the owner (2026-11-10).** | Final |
| D14 | Stack | Frontend: the owner's **existing React UI** (reuse its design and components). Backend: **Django + Django REST Framework + PostgreSQL**. The old Node backend is replaced and not ported. | Final |
| D15 | Opening stock | Entered as `opening_balance` stock movements, **not** as a purchase, so it never inflates expenses. | Final |
| D16 | Modifier groups | Reusable across products (linked many-to-many), instead of being duplicated per product. | Final (design) |
| D17 | Card terminal reference | Optional on card payments and card refunds. **Confirmed by the owner (2026-11-10).** | Final |
| D18 | Packaged goods (no recipe) | Modeled as an ingredient in `pcs` with a one-line recipe (qty 1, waste 0). No separate stock-item model. A size that truly uses no stock (a service item) is marked "No stock tracking" (`track_stock = false`, Sprint 4 B3). | Final (design) |

---

## 3. Scope

### 3.1 P0 — required for production

- Auth, sessions and fixed roles; user management.
- Tenancy foundation and organization settings.
- Catalog:
  - Categories, products and variants (sizes with prices).
  - Ingredients.
  - Recipes per variant with a fixed waste %.
  - Modifier groups and options (add / replace) with per-variant ingredient effects.
- Inventory:
  - Stock balances and an append-only stock movement ledger.
  - Adjustments and physical counts.
  - Opening balances.
- Sales:
  - Server quote with stock warnings.
  - Atomic, idempotent checkout.
  - Payments: cash, card, or mixed.
  - Gapless invoice numbers.
  - Receipts with print and reprint.
  - Order history.
- Shifts: per user open and close with cash reconciliation.
- Refunds: full only, audited, idempotent.
- Suppliers; purchases (draft → post once); expenses (general and drawer, with admin void).
- Reports:
  - Sales summary
  - Payment breakdown
  - Top products
  - Stock
  - Purchases and expenses
  - Shifts
- Audit log with an admin viewer.
- Tests, CI, Docker deployment, backup and restore.

### 3.2 P1 — only if every P0 item is green

- Simple time-boxed promotions (percentage or fixed amount per variant, no stacking).
- Extra reporting polish.

### 3.3 Out of scope for v1

- Offline mode and sync.
- Payment gateway or terminal integration.
- Delivery, tables, and kitchen display.
- Customer accounts and credit.
- Multi-branch and multi-warehouse (beyond the seeded single rows); stock transfers.
- ERP accounting, COGS and profit reports.
- Government e-invoice / e-receipt integration.
- Partial refunds.
- Promotion stacking, BOGO and combos.
- Manual cashier discounts.
- Payroll.
- Supplier credit and accounts payable (purchases are treated as paid immediately).
- Events module.

### 3.4 Later (SaaS backlog — do not build now)

- Tenant onboarding and signup.
- Subdomain or tenant routing.
- Billing.
- Custom roles and permissions.
- Arabic UI translation (the infrastructure is built now).
- Multiple registers and warehouses.
- COGS and average cost.
- Manual discounts.
- Partial refunds.

---

## 4. Tech stack and repository

### 4.1 Backend

- **Language and framework:** Python 3.12+, Django 5.x, Django REST Framework, PostgreSQL 16.
- **Libraries:**
  - `django-environ` (settings from environment)
  - `django-filter`
  - `drf-spectacular` (OpenAPI schema served at `/api/v1/schema/` and `/api/v1/docs/` in non-production)
  - `gunicorn` (production)
- **Tests:** `pytest`, `pytest-django`, `factory_boy`.
- **Lint and format:** `ruff` for both.
- **Auth:**
  - Django session authentication with secure cookies and CSRF.
  - Frontend served from the same origin in production.
  - In development, Vite proxies `/api` to Django.
  - No JWT.
- **Rate limiting:** login is rate limited (DRF throttling on the login view, e.g. 10/min per IP and per username).

### 4.2 Frontend

- **Base:** the owner's existing React app. Keep its visual design and reusable components.
- **Requirements:**
  - TypeScript for all new code. If the existing app is JavaScript, enable `allowJs` and migrate files as you touch them. Do not do a big-bang rewrite.
  - Vite build. If the existing app uses something else, report it in Sprint 0 and ask.
  - `react-router`.
  - `@tanstack/react-query` for server state.
  - `react-i18next` for all user-visible strings.
  - A small API client module.
- **Money:**
  - Never do money math with JS floats.
  - The server is authoritative for all totals.
  - The client displays decimal strings as returned.
  - For change calculation in the payment dialog, use a decimal library (e.g. `decimal.js`) or integer piastres.

### 4.3 Repository layout (target)

```
/
├─ CLAUDE.md
├─ docker-compose.yml              # dev: postgres (+ optional backend)
├─ docker-compose.prod.yml         # prod: proxy + backend + postgres + backup
├─ .env.example
├─ .github/workflows/ci.yml
├─ backend/
│  ├─ manage.py
│  ├─ pyproject.toml
│  ├─ config/                      # settings/{base,dev,test,prod}.py, urls.py, wsgi.py
│  └─ apps/
│     ├─ core/                     # base models, envelope renderer, exception handler,
│     │                            # money/qty utils, idempotency, policy, time utils
│     ├─ tenancy/                  # Organization, OrganizationSettings, Branch, Location, Register
│     ├─ accounts/                 # custom User, auth views, user management
│     ├─ catalog/                  # Category, Product, ProductVariant, RecipeLine
│     ├─ modifiers/                # ModifierGroup, ProductModifierGroup, ModifierOption,
│     │                            # ModifierOptionPrice, ModifierEffect
│     ├─ inventory/                # Ingredient, StockBalance, StockMovement, StockAdjustment
│     ├─ shifts/                   # CashierShift
│     ├─ sales/                    # pricing engine, Order, OrderItem, Payment, Refund,
│     │                            # RefundLine, InvoiceCounter
│     ├─ purchasing/               # Supplier, Purchase, PurchaseItem
│     ├─ expenses/                 # Expense
│     ├─ promotions/               # Promotion (P1)
│     ├─ reports/                  # read-only report services and views
│     └─ audit/                    # AuditEvent + audit service
├─ frontend/                       # existing React app (moved here if needed)
├─ legacy/                         # old Node backend if present: untouched, excluded from tooling
├─ ops/                            # backup/restore scripts, proxy config
└─ docs/
   ├─ PROJECT_SPEC.md
   ├─ PROGRESS.md
   ├─ sprints/
   ├─ OPERATIONS.md                # Sprint 5
   ├─ BACKUP_RESTORE.md            # Sprint 5
   └─ USER_GUIDE.md                # Sprint 5
```

If the existing frontend repo has a different shape, propose the move in the Sprint 0 audit and wait for approval before restructuring.

### 4.4 Full check suite (must pass at the end of every sprint and in CI)

- **Backend:**
  - `ruff check`
  - `ruff format --check`
  - `python manage.py makemigrations --check --dry-run`
  - `pytest` (with coverage report)
- **Frontend:**
  - `tsc --noEmit`
  - lint
  - `vite build`
- **From Sprint 4:** Playwright E2E for critical flows.

---

## 5. Engineering rules (non-negotiable)

### 5.1 Money, quantities, rounding

- Store money as `DecimalField(max_digits=12, decimal_places=2)`.
- Store quantities as `DecimalField(max_digits=14, decimal_places=3)`.
- Store unit costs as `decimal_places=4`.
- Never use `float` anywhere in money or quantity paths: Python, SQL, or JS.
- Rounding is `ROUND_HALF_UP`:
  - money to 2 dp;
  - quantities to 3 dp.
- Put all rounding in `apps/core/money.py` (`q_money()`, `q_qty()`). Do not round anywhere else.
- In the API, money and quantities are JSON **strings** (`"125.00"`, `"12.500"`). Reject numeric JSON for these fields with `VALIDATION_ERROR`.
- Currency comes from organization settings (default `EGP`).

### 5.2 Tenancy (SaaS foundation)

- Every tenant-owned model inherits `TenantModel`, an abstract base with:
  - `id` (UUID4 primary key)
  - `organization` (FK, `PROTECT`, indexed)
  - `created_at`
  - `updated_at`
- Every request resolves `request.organization` from `request.user.organization`, using middleware or a DRF mixin.
- Every queryset in views must be scoped through one helper. Use a `TenantScopedViewSetMixin` that filters `organization=request.organization`, so no view can forget it.
- Write a test that creates two organizations and asserts that no list or detail endpoint leaks data across them.
- Uniqueness constraints that are "per café" include `organization` (e.g. `unique(organization, name)`).
- Settings that differ per café live in `OrganizationSettings`, never in code constants:
  - currency
  - timezone
  - receipt header and footer
  - invoice prefix
  - tax settings
  - default receipt paper width
- **Seed** (data migration or `seed_org` management command, idempotent), one row each:
  - `Organization` "Drip Café"
  - `OrganizationSettings`
  - `Branch` "Main"
  - `Location` "Main Stock" (`is_default=True`)
  - `Register` "Main Register" (`is_default=True`)

### 5.3 Transactions, concurrency, idempotency

- Every operation that changes money or stock runs inside `transaction.atomic()` in a **service function** (`services.py`). Views stay thin: validate input, call the service, serialize the result.
- **Stock updates:**
  1. Lock the affected `StockBalance` rows with `select_for_update()`, ordered by `ingredient_id` (avoids deadlocks).
  2. Update the balance and write `StockMovement.balance_after`.
  3. Never read-modify-write without the lock.
- **Invoice numbers** use a locked counter row (Section 8.11), so they are gapless.
- **Idempotency** (`apps/core/idempotency.py`) applies to:
  - checkout
  - refund
  - purchase post

  Rules:
  - The `Idempotency-Key` header is required (UUID). If missing, return 400 `IDEMPOTENCY_KEY_REQUIRED`.
  - The record is `IdempotencyRecord(organization, scope, key, request_hash, response_status, response_body, user, created_at)` with `unique(organization, scope, key)`.
  - `scope` is one of `checkout`, `refund:<order_id>`, `purchase_post:<purchase_id>`.
  - `request_hash` is SHA-256 of the canonical JSON body (sorted keys) plus the scope.
  - The record is inserted inside the same transaction as the business write. On success, the response is stored.
  - Failures roll back everything, including the record, so the client may retry with the same key.
  - On a unique-violation race, re-read the committed record and return it.
  - Same key and same hash returns the stored status and body, plus the response header `Idempotent-Replayed: true`.
  - Same key and different hash returns 409 `IDEMPOTENCY_CONFLICT`.
  - Same key sent by a **different user** also returns 409 `IDEMPOTENCY_CONFLICT` (a key belongs to the user who first sent it; Sprint 2 audit).

### 5.4 History is immutable

- Never hard-delete:
  - orders, payments, refunds;
  - stock movements;
  - posted purchases, expenses;
  - shifts;
  - audit events;
  - users with history.

  Deactivate (`is_active=False`) or void instead.
- `StockMovement` and `AuditEvent` are append-only. Override `save()` (reject updates) and `delete()` (raise) and test it.
- Paid orders are never edited. Status changes only through the refund service.
- Disabling a product, variant, option or ingredient prevents **new** use only. History reads from snapshots.
- Draft purchases may be deleted. Nothing posted may be deleted.

### 5.5 Permissions

- Use one policy module, `apps/core/policy.py`, with named permissions (`catalog.manage`, `sales.checkout`, `refund.create`, `reports.view`, …) mapped to roles.
- DRF permission classes call the policy.
- Never rely on the frontend for access control.
- Every endpoint has a parametrized permission test: anonymous → 401, barista on admin-only → 403, and no side effects.
- Deactivated users cannot log in, and their existing sessions are rejected (check `is_active` on every request).

### 5.6 Audit

- `apps/audit/services.py::record(actor, action, entity, summary)`.
- Called explicitly from services for:
  - user created, updated, deactivated or reactivated; password reset;
  - organization settings changed;
  - category, product or variant created or updated (including price changes with before/after);
  - recipe replaced (before/after lines);
  - modifier group, option or effect changes;
  - stock adjustment, physical count, opening balance;
  - purchase posted;
  - expense created or voided;
  - shift opened or closed;
  - checkout (`order.created`);
  - refund created.
- Never put passwords, session IDs, CSRF tokens or secrets in an audit event.

### 5.7 Time

- `USE_TZ=True`. Store UTC.
- The display and business timezone comes from organization settings (default IANA `Africa/Cairo`). Never hardcode `+02:00`: Egypt uses daylight saving time.
- Report filters take local dates (`YYYY-MM-DD`). Convert them to the UTC range `[from 00:00 local, to+1 day 00:00 local)`.
- Return the resolved range in `meta`.

### 5.8 i18n and RTL (frontend)

- No hardcoded user-visible strings. Everything goes through `t('key')`.
- Ship `en.json` complete and an `ar.json` skeleton with the same keys (values may be empty, falling back to English).
- Set `<html dir lang>` from the active language.
- Use CSS logical properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `text-align: start`) instead of left/right.
- Format numbers, dates and money through one formatting helper.
- **API errors:** the backend returns stable `error.code` plus an English `message`. The frontend shows `t('errors.<CODE>')`, falling back to `message`.

### 5.9 Security and operations

- HTTPS in production.
- `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SESSION_COOKIE_HTTPONLY`, and `SameSite=Lax`.
- `DEBUG=False` in production.
- `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` from the environment.
- No secrets in Git. Commit `.env.example` only.
- Use Django password hashing and password validators.
- Structured JSON logging. Never log passwords, tokens, cookies or full request bodies of auth endpoints.
- `GET /api/v1/health` returns `{"data":{"status":"ok","db":"ok"}}` and does not expose versions or secrets.

---

## 6. Roles and permissions

`A` = Admin, `B` = Barista.

| Capability | A | B |
|---|---|---|
| Login, logout, view own profile | ✓ | ✓ |
| View catalog for selling (active items) | ✓ | ✓ |
| Quote, checkout, take payment | ✓ | ✓ |
| Open own shift, view own current shift, close own shift | ✓ | ✓ |
| Close **another** user's shift (e.g. forgotten) | ✓ | ✗ |
| View all shifts and shift reports | ✓ | ✗ |
| View orders | All | List: today's orders (all cashiers) + exact invoice-number lookup for any date. Detail/receipt: any order opened by its id (owner decision, 2026-11-10) |
| View and print receipts for viewable orders | ✓ | ✓ |
| Refund a paid order (full, with reason) | ✓ | ✓ |
| Record drawer expense against own open shift [D10] | ✓ | ✓ |
| Record external expenses, view all expenses, void expenses | ✓ | ✗ |
| Manage categories, products, variants, prices | ✓ | ✗ |
| Manage recipes, modifier groups, options, effects | ✓ | ✗ |
| Manage ingredients; view balances and movements; adjustments, counts, opening balances | ✓ | ✗ |
| Suppliers and purchases | ✓ | ✗ |
| Promotions (P1) | ✓ | ✗ |
| Users (create, deactivate, reset password, change role) | ✓ | ✗ |
| Organization settings | ✓ | ✗ |
| Reports and audit log | ✓ | ✗ |

**Rules:**
- An Admin cannot deactivate themselves.
- The last active Admin cannot be deactivated or demoted. Return 422 `LAST_ADMIN`.

---

## 7. Data model

Every model below except `Organization` inherits `TenantModel` (`id` UUID, `organization`, `created_at`, `updated_at`) unless noted. `FK` uses `on_delete=PROTECT` unless stated. Add DB-level `CheckConstraint`s and `UniqueConstraint`s where listed; do not rely only on serializers.

### 7.1 tenancy

| Model | Fields | Constraints / notes |
|---|---|---|
| `Organization` (not tenant-owned) | id, name, slug, is_active, created_at | slug unique |
| `OrganizationSettings` | organization (1:1); currency `EGP`; timezone `Africa/Cairo`; default_language `en`; business_name; receipt_header (text); receipt_footer (text); receipt_paper_width (`58mm`/`76mm`/`80mm`/`112mm`/`a4`, default `80mm`); invoice_prefix `POS-`; tax_enabled `False`; tax_rate `0.00`; prices_include_tax `False` (tax added on top); tax_label `VAT`; tax_registration_number (blank) | tax_rate 0–100 |
| `Branch` | name, is_active | unique(org, name) |
| `Location` | branch, name, is_default | one default per branch (partial unique) |
| `Register` | branch, name, is_default | one default per branch; stored on shifts for future multi-register |

### 7.2 accounts

- **`User`** — custom model, created **before the first migration**, `AUTH_USER_MODEL = "accounts.User"`. Extends `AbstractUser`. Fields:
  - `id` (UUID)
  - `organization` (FK)
  - `role` (`admin` / `barista`)
  - `display_name`
  - `preferred_language` (`en` / `ar`, default `en`)
  - `is_active`
- `username` is unique globally for v1.
- Never return password hashes from the API.

### 7.3 catalog

| Model | Fields | Constraints / notes |
|---|---|---|
| `Category` | name, sort_order, is_active | unique(org, name) |
| `Product` | category, name, description (blank), sort_order, is_active | unique(org, name) |
| `ProductVariant` | product, label, sku (nullable), price (money ≥ 0), sort_order, is_active, **track_stock** (bool, default true) | unique(product, label); unique(org, sku) where sku not null. **B3 (owner, 2026-11-11):** `track_stock = true` → the size must have at least one recipe line to be sold; `false` ("No stock tracking") → it sells with no deduction and must keep an empty recipe. API adds read-only `has_recipe`. |
| `RecipeLine` | variant (FK CASCADE is acceptable only because recipes are replaced wholesale and history lives in snapshots), ingredient, base_qty (qty ≥ 0), waste_pct (decimal 5,2 in 0–100), slot_key (slug, nullable) | unique(variant, ingredient); unique(variant, slot_key) where slot_key not null |

A product is sellable only if it and its category are active and it has at least one active variant. A tracked variant with no recipe is not sellable (422 `RECIPE_MISSING`); the till greys it out.

### 7.4 modifiers

| Model | Fields | Constraints / notes |
|---|---|---|
| `ModifierGroup` | name, mode (`add`/`replace`), replacement_slot (slug, nullable), min_select (≥ 0), max_select (≥ 1, ≥ min), sort_order, is_active | replacement_slot required iff mode=`replace`; unique(org, name) |
| `ProductModifierGroup` | product, group, sort_order | unique(product, group); links reusable groups to products |
| `ModifierOption` | group, label, price_delta (money ≥ 0), sort_order, is_active, **track_stock** (bool, default true) | unique(group, label). **R2 (owner, 2026-11-11):** `false` = "No stock effect" (e.g. No ice, No milk); such an option must keep no effects. |
| `ModifierOptionPrice` | option, variant, price_delta | unique(option, variant). Optional per-size price override |
| `ModifierEffect` | option, variant (**nullable** = applies to all variants), ingredient, base_qty (≥ 0), waste_pct (0–100) | unique(option, variant, ingredient) |

**Effect resolution for an option on a variant:**
1. If any effects exist with `variant = that variant`, use only those.
2. Otherwise use the effects with `variant IS NULL`.
3. If the option has effects but none apply to this variant, the selection is invalid: 422 `INVALID_MODIFIER`.
4. An option marked "No stock effect" (`track_stock = false`) has no inventory impact. In `replace` mode, this means "remove the slot", e.g. "No milk".
5. **Sprint 4 R2:** a tracked option (`track_stock = true`) with **no effects at all** is invalid: 422 `INVALID_MODIFIER` (details `reason: no_effect`). Nothing is ever deducted silently.

### 7.5 inventory

| Model | Fields | Constraints / notes |
|---|---|---|
| `Ingredient` | name, base_unit (`g`/`ml`/`pcs`), low_stock_threshold (qty, nullable), reference_unit_cost (decimal 12,4, nullable, informational), is_active | unique(org, name). A `StockBalance` row is created automatically for the default location |
| `StockBalance` | ingredient, location, qty (may be negative) | unique(ingredient, location). Never edited directly by API |
| `StockAdjustment` | ingredient, location, kind (`adjustment`/`count`/`opening_balance`), qty_delta, counted_qty (nullable, for `count`), reason, created_by | reason required for adjustment and count |
| `StockMovement` | ingredient, location, qty_delta (≠ 0), movement_type (`opening_balance`/`sale`/`purchase`/`adjustment`), source_type (`order_item`/`purchase_item`/`stock_adjustment`), source_id (UUID), balance_after, created_by, occurred_at | **append-only**; unique(source_type, source_id, ingredient) prevents double posting; index (ingredient, occurred_at) |

### 7.6 shifts

`CashierShift` fields:
- `branch`, `register`, `user`
- `status` (`open` / `closed`)
- `opening_cash` (≥ 0), `opened_at`
- `closed_at`, `closed_by`
- `expected_cash`, `actual_cash`, `difference`
- `close_note`
- `totals_snapshot` (JSON: `cash_sales`, `card_sales`, `cash_refunds`, `card_refunds`, `drawer_expenses`, `orders_count`)

Constraint: **partial unique (user) where status = 'open'**.

### 7.7 sales

| Model | Fields | Constraints / notes |
|---|---|---|
| `InvoiceCounter` | organization (unique), last_number (int) | Locked with `select_for_update` |
| `Order` | branch, shift, cashier, invoice_seq (int), invoice_no, status (`paid`/`refunded`), subtotal, discount_total, tax_total, total, tax_snapshot (JSON: enabled, rate, inclusive, label), note, idempotency_key | unique(org, invoice_no); unique(org, invoice_seq); unique(org, idempotency_key) |
| `OrderItem` | order, variant (FK), quantity (int ≥ 1), product_name_snapshot, variant_label_snapshot, unit_price, unit_discount, line_subtotal, line_discount, line_total, modifiers_snapshot (JSON), recipe_snapshot (JSON), consumption_snapshot (JSON), promotion_snapshot (JSON, nullable) | see Section 8.4 for snapshot shapes |
| `Payment` | order, shift, method (`cash`/`card`), amount (> 0), cash_tendered (nullable), change_given (nullable), external_reference (blank) | unique(order, method). Mixed = one cash row + one card row |
| `Refund` | order (**1:1**, full refunds only), actor, shift (nullable), reason, total_amount, idempotency_key | |
| `RefundLine` | refund, original_payment, method, amount, external_reference (blank) | |

### 7.8 purchasing and expenses

| Model | Fields | Constraints / notes |
|---|---|---|
| `Supplier` | name, phone (blank), notes (blank), is_active | unique(org, name) |
| `Purchase` | supplier (nullable), supplier_invoice_no (blank), purchased_on (date), status (`draft`/`posted`), payment_method (`cash`/`card`/`transfer`), source (`external`/`cash_drawer`), notes, total, posted_at, posted_by, created_by | Editable and deletable only while `draft` |
| `PurchaseItem` | purchase, ingredient, qty (base units, > 0), unit_cost (decimal 12,4 per base unit, ≥ 0), line_total, pack_label (blank), pack_count (nullable), pack_size (nullable) | Pack fields are an input convenience: `qty = pack_count × pack_size` |
| `Expense` | type (`general`/`purchase`), category (`utilities`/`rent`/`maintenance`/`supplies`/`transport`/`cleaning`/`other`/`purchase`), description, amount (> 0), payment_method (`cash`/`card`/`transfer`), source (`cash_drawer`/`external`), shift (nullable), purchase (1:1 nullable, unique), paid_at, status (`posted`/`voided`), void_reason, voided_by, voided_at, created_by | Check: source=`cash_drawer` ⇒ shift not null and payment_method=`cash`. A purchase has at most one expense |

### 7.9 promotions (P1) and audit

| Model | Fields |
|---|---|
| `Promotion` | name, discount_type (`percentage`/`fixed_amount`), discount_value, variants (M2M), starts_at, ends_at, is_active. Check: ends_at > starts_at; percentage in (0, 100] |
| `AuditEvent` | actor (nullable), action (e.g. `refund.created`), entity_type, entity_id, summary (JSON), created_at. **Append-only**; index (org, created_at), (entity_type, entity_id) |
| `IdempotencyRecord` | see Section 5.3 |

---

## 8. Business rules and algorithms

### 8.1 Pricing engine

`apps/sales/pricing.py`. This is a pure function over loaded data, unit-tested heavily. Quote and checkout must call the same engine.

For each requested item `{variant_id, quantity, modifier_option_ids}`:

1. **Validate the item:**
   - `quantity` is an integer from 1 to 99. Otherwise 422 `INVALID_QUANTITY`.
   - The variant, product and category are active. Otherwise 422 `ITEM_UNAVAILABLE`.
2. **Validate modifiers:**
   - Each option is active, its group is active, and the group is linked to the product. Otherwise 422 `INVALID_MODIFIER`.
   - Count the selected options per linked group. Every linked group must satisfy `min_select ≤ n ≤ max_select`, including groups with zero selections. Otherwise 422 `MODIFIER_SELECTION_INVALID`.
   - No duplicate option IDs.
3. **Compute prices:**
   - `unit_price = variant.price + Σ option price`. Each option price is its `ModifierOptionPrice` for this variant if one exists, else `price_delta`.
   - **Promotion (P1):** the best single active promotion for the variant at `now`, applied to `variant.price` only (not modifiers). Pick the largest discount; on a tie, the earliest created.
     - `unit_discount = q_money(variant.price × pct / 100)` or `min(value, variant.price)`.
     - Without promotions, `unit_discount = 0`.
   - `line_subtotal = unit_price × qty`
   - `line_discount = unit_discount × qty`
   - `line_total = line_subtotal − line_discount`

Order level:
- `subtotal = Σ line_subtotal`
- `discount_total = Σ line_discount`
- `net = subtotal − discount_total`

**Tax** (from settings at sale time; snapshot it into `tax_snapshot`):

| Case | `tax_total` | `total` |
|---|---|---|
| Tax disabled | `0.00` | `net` |
| Enabled, prices include tax | `q_money(net × rate / (100 + rate))` | `net` |
| Enabled, tax added on top | `q_money(net × rate / 100)` | `net + tax_total` |

### 8.2 Consumption engine

`apps/sales/consumption.py`. This is also a pure function.

For each item:

0. **Recipe required (Sprint 4 B3):** if the variant has `track_stock = true` and no recipe lines, return 422 `RECIPE_MISSING` (details: `variant_id`, `product_name`, `variant_label`). Quote and checkout both run this, so the whole cart is refused and nothing is written.
1. **Build the working lines.** Start from the variant's `RecipeLine`s, keyed by `slot_key`, or by `"ing:<ingredient_id>"` when there is no slot.
2. **Apply selected options, grouped by group:**
   - **`replace` group:**
     - If `replacement_slot` is not in the working lines, return 422 `INVALID_MODIFIER` (details: `slot_missing`).
     - Remove that slot **once**.
     - Add the resolved effects of each selected option (Section 7.4).
   - **`add` group:** add the resolved effects of each selected option.
3. **Compute per-unit consumption** for each line: `q_qty(base_qty × (1 + waste_pct / 100))`. Waste is applied exactly once, here.
4. **Multiply** by `quantity` and aggregate per ingredient across the whole order.
5. **Stock warnings** (default location), for each ingredient:
   - `available` = current balance
   - `required` = aggregated total
   - `projected = available − required`
   - If `projected < 0`, add `{ingredient_id, ingredient_name, unit, available, required, projected_balance}` to `stock_warnings`.
   - Warnings **never block** quote or checkout.

**Worked check (AT-03):**
- Base 12.000 g with 5% waste gives 12.600 g per unit.
- Quantity 2 gives 25.200 g.

### 8.3 Quote — `POST /orders/quote`

- Read-only. Runs 8.1 and 8.2 and returns totals, lines and warnings.
- Does not lock, write, or require a shift. This lets the UI show prices before a shift is open, but checkout still requires one.

### 8.4 Checkout — `POST /orders/checkout`

Everything below runs in one `transaction.atomic()`, inside the idempotency wrapper (scope `checkout`).

1. The cashier must have an open shift. Otherwise 409 `SHIFT_NOT_OPEN`.
2. Cart must be non-empty. Otherwise 422 `EMPTY_CART`.
3. Run the pricing and consumption engines with fresh DB data.
4. Compare `expected_total` (from the client) with the server total. If they differ, return 409 `PRICE_CHANGED` with `details: {server_total, quote}`.
5. **Validate payments:**
   - **A 0.00 order takes no payment:** `payments` must be empty (otherwise 422 `INVALID_PAYMENT`). Owner decision, 2026-11-10.
   - Otherwise 1–2 entries, at most one per method. Otherwise 422 `INVALID_PAYMENT`.
   - Each amount > 0.
   - `Σ amount == total`. Otherwise 422 `PAYMENT_MISMATCH`.
   - For cash: `cash_tendered` is optional and defaults to the amount, and must satisfy `cash_tendered ≥ amount`. Otherwise 422 `INVALID_PAYMENT`.
   - `change_given = cash_tendered − amount`.
   - Card: `external_reference` is optional [D17].
6. Lock and increment the `InvoiceCounter`. `invoice_no = f"{prefix}{seq:07d}"`.
7. Create the `Order` (`status=paid`, totals, `tax_snapshot`, shift, cashier).
8. Create the `OrderItem`s with snapshots:
   - `modifiers_snapshot`: `[{group_id, group_name, mode, option_id, option_label, price_delta}]`
   - `recipe_snapshot`: `[{ingredient_id, ingredient_name, unit, base_qty, waste_pct, slot_key, source: "recipe"|"modifier", option_id?}]` (the final working lines after modifiers)
   - `consumption_snapshot`: `[{ingredient_id, ingredient_name, unit, qty_per_unit, total_qty}]`
   - `promotion_snapshot`: `{promotion_id, name, discount_type, discount_value, unit_discount}` or null
9. Create the `Payment`s linked to the cashier's shift.
10. Lock the `StockBalance` rows (ordered by `ingredient_id`), apply negative deltas, and create the `StockMovement`s:
    - `movement_type = sale`
    - `source_type = order_item`
    - one row per (order item, ingredient)
11. Record the audit event `order.created`.
12. Return 201: order summary, payments, `change_due`, `receipt_url`, `stock_warnings`.

A failure at any step rolls back everything: no order, no payments, no movements, no counter increment.

### 8.5 Shifts

**Open** — `POST /shifts/open {opening_cash}`:
- If the user already has an open shift, return 409 `SHIFT_ALREADY_OPEN`.
- The shift uses the default branch and register.

**Current** — `GET /shifts/current` returns the user's open shift with live totals, or `data: null`.

**Close** — `POST /shifts/{id}/close {actual_closing_cash, note}`, by the owner or an Admin:
- If the shift is already closed, return 409 `SHIFT_ALREADY_CLOSED`.
- `expected_cash = opening_cash + Σ cash Payment.amount (this shift) − Σ cash RefundLine.amount (refunds whose shift = this shift) − Σ Expense.amount (source=cash_drawer, status=posted, shift = this shift)`
- `difference = actual − expected` (negative means a shortage).
- Store `totals_snapshot`, set `closed_at` and `closed_by`, and write an audit event.
- Closed shifts are immutable. Voiding an expense later does not change a closed shift's stored numbers.

**Accountability [D7]:** every cashier is accountable for their own shift. The system makes no attempt to split a shared physical drawer.

### 8.6 Refunds — `POST /orders/{id}/refunds`

Idempotent, scope `refund:<order_id>`. Body:

```json
{"reason":"...", "confirm_amount":"110.00", "card_external_reference":null}
```

Rules:
1. The order must be visible to the user (Section 6).
2. If `order.status != paid`, return 409 `REFUND_ALREADY_APPLIED`.
3. `reason` must be trimmed and at least 3 characters. Otherwise `VALIDATION_ERROR`.
4. If `confirm_amount != order.total`, return 422 `PARTIAL_REFUND_NOT_SUPPORTED`.
5. **Allocation [D9]:** create one `RefundLine` per original `Payment`, with the same method and amount. Attach `card_external_reference` to the card line.
6. **Shift:**
   - If any cash line exists, the **refunding user** must have an open shift (otherwise 409 `SHIFT_NOT_OPEN`). `refund.shift` is that shift, so the cash leaves that user's expected cash.
   - For a card-only refund, `refund.shift` is the user's open shift if one exists, else null.
7. Set `order.status = refunded`.
8. **No stock restoration** (owner, 2026-11-10: the Admin adjusts stock manually if needed). The response includes `inventory_restored: false`. If an unopened packaged item is returned to stock, the Admin uses a stock adjustment.
9. Record the audit event `refund.created` with invoice_no, actor, reason, lines and original cashier.
10. The UI states that card refunds must be performed on the external terminal by staff.

### 8.7 Purchases

1. **Draft:** `POST /purchases`, `PATCH /purchases/{id}` (draft only; otherwise 409 `PURCHASE_NOT_EDITABLE`), and `DELETE /purchases/{id}` (draft only). The server computes `line_total` and `total`.
2. **Post:** `POST /purchases/{id}/post`, idempotent with scope `purchase_post:<id>`. It requires at least one item, then:
   - Creates `StockMovement`s (`purchase`, `source_type = purchase_item`) and updates balances under lock.
   - Creates **one** `Expense`:
     - `type = purchase`, `category = purchase`, `amount = total`.
     - `payment_method` and `source` come from the purchase.
     - If `source = cash_drawer`, the poster's own open shift is required, **an Admin included** (owner, 2026-11-10; otherwise 409 `SHIFT_NOT_OPEN`). The expense is attached to that shift.
   - Sets `status = posted`, `posted_at`, `posted_by`.
   - Records an audit event.
3. If the purchase is already posted and the call uses a different key, return 409 `PURCHASE_ALREADY_POSTED`.

### 8.8 Expenses

- **Admin:** any source and method.
- **Barista [D10]:**
  - The server forces `source = cash_drawer`, `payment_method = cash`, and `shift` = the user's own open shift (409 `SHIFT_NOT_OPEN` if none).
  - Category and description are required.
- **Void:** `POST /expenses/{id}/void {reason}`, Admin only.
  - Purchase-type expenses cannot be voided this way (422 `EXPENSE_NOT_VOIDABLE`).
  - A drawer expense whose shift is already **closed** cannot be voided either (422 `EXPENSE_NOT_VOIDABLE`, owner kickoff 2026-11-10), and neither can an already voided one. This keeps a closed shift's numbers true as well as frozen.
  - Voided expenses are excluded from reports and from open-shift expected cash.
  - Records an audit event.
- Expenses are never edited.

### 8.9 Inventory operations (Admin)

- **Adjustment:** `POST /inventory/adjustments` with `{ingredient_id, mode:"delta", qty_delta, reason}` or `{ingredient_id, mode:"count", counted_qty, reason}`.
  - For `count`, `delta = counted_qty − current balance` (computed under lock). If delta is 0, record the count but create no movement.
  - The reason is mandatory.
- **Opening balance:** `POST /inventory/opening-balances {items:[{ingredient_id, qty}]}`.
  - Allowed only for ingredients with **no** prior movements. Otherwise 409 `OPENING_BALANCE_EXISTS`.
  - Creates `opening_balance` movements. Never creates an expense [D15].
- Ingredient `PATCH` never accepts balance fields.

### 8.10 Recipes

`PUT /variants/{id}/recipe {lines:[...]}` replaces the whole recipe atomically. It validates:
- the ingredients exist and are active;
- `base_qty ≥ 0`;
- waste is between 0 and 100;
- there are no duplicate ingredients or slots;
- **Sprint 4 B3:** a variant marked "No stock tracking" (`track_stock = false`) accepts only an empty recipe (422 `INVALID_RECIPE`, `reason: stock_not_tracked`), and `PATCH /variants/{id}` cannot set `track_stock = false` while the variant has recipe lines (400). Both take the variant row lock, so they never interleave.

**Replace-group integrity:** if a product linked to a `replace` group has a variant whose recipe lacks that group's `replacement_slot`:
- the recipe `PUT` still succeeds;
- the response includes a `warnings` array;
- the admin UI shows that warning;
- sales of that variant with that group's options fail with `INVALID_MODIFIER` until it is fixed.

The old recipe goes into the audit summary.

### 8.11 Invoice numbers

- One `InvoiceCounter` row per organization, locked with `select_for_update` inside checkout.
- Because the increment rolls back with a failed checkout, numbers are **gapless**.
- Format: `invoice_prefix` + 7-digit zero-padded sequence.

### 8.12 Promotions (P1)

- **Applies when:**
  - `is_active`;
  - `starts_at ≤ now < ends_at`;
  - the variant is in the promotion.
- No stacking (Section 8.1).
- A discount never makes a price negative.
- Snapshotted on the order item. Editing a promotion never changes past orders.

### 8.13 Report definitions

All reports are Admin-only and are derived from persisted records only. Period filters work as in Section 5.7. Optional filters are `cashier_id` and `shift_id` where meaningful.

| Report | Fields and definitions |
|---|---|
| `sales-summary` | `orders_count` (orders created in period, any status); `gross_sales` = Σ subtotal; `discounts` = Σ discount_total; `tax` = Σ tax_total; `collected` = Σ total; `refunds` = Σ refund total_amount with refund created in period; `net_sales` = collected − refunds; `refunded_orders_count` |
| `payment-breakdown` | `cash_collected`, `card_collected` (Σ Payment.amount by method, payment date in period); `cash_refunded`, `card_refunded` (Σ RefundLine by method, refund date in period); `cash_net`, `card_net` |
| `top-products` | Per variant from order-item snapshots, **excluding refunded orders**: `product_name_snapshot`, `variant_label_snapshot`, `qty_sold`, `net_revenue` (Σ line_total). Sort by `qty` or `revenue` (`ordering` param). **At most 100 rows**; `meta.limit` = 100 and `meta.truncated` = true when rows were cut (Q6 item 4A, owner 2026-11-11) |
| `stock` | Per ingredient: unit, balance, threshold, is_low (balance ≤ threshold), is_negative, consumed_qty_period (Σ −qty_delta of `sale` movements in period) |
| `purchases-expenses` | From `Expense` only (status=posted), so no double counting: `purchase_total`, `general_expenses_total`, `cash_drawer_total`, `external_total`, `breakdown` by category. **No `cashier_id` / `shift_id` filter:** sending either returns 400 (purchases and external expenses have no shift, so a filter would silently drop them — Q6 item 3A, owner 2026-11-11) |
| `shifts` | `shifts_count`, `open_count`, `closed_count`, `expected_cash_total`, `actual_cash_total`, `total_difference`, `shifts[]` (user, opened_at, closed_at, opening_cash, expected, actual, difference, orders_count) |

**Dates and filters (implemented in Sprint 3):** orders, their payments and their items are dated by the order's `created_at`; refunds and their lines by the refund's `created_at`; expenses by `paid_at`; stock movements by `occurred_at`; shifts by `opened_at`. Orders and payments share the order's date so the invariant below holds at any midnight boundary. `cashier_id` filters orders by their cashier and refunds by the **refunding** user; `shift_id` filters orders and payments by their shift and refunds by the refunding user's shift. With no dates a report covers the café's local today, and `meta.range` echoes the resolved range.

**Reconciliation invariant (tested):** for any period, `cash_collected + card_collected == collected`, and `cash_refunded + card_refunded == refunds`.

---

## 9. API contract — `/api/v1`

### 9.1 Conventions

- JSON over HTTPS, `snake_case`, UUID IDs, ISO-8601 timestamps (UTC, `Z`). Money and quantities are decimal strings.
- **Success envelope:** `{"data": ..., "meta": {...}}`. Lists add `meta: {page, page_size, total_count}`.
- **Error envelope:** `{"error":{"code":"...","message":"...","details":{...}}}`. Implement it with a custom exception handler and renderer. DRF field errors go in `details.fields`.
- **List parameters:** `page`, `page_size` (default 20, max 100), `search`, `ordering`, plus resource filters.
- **Status codes:** 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500.
- **CSRF:** `GET /auth/csrf` sets the cookie. Unsafe methods send the `X-CSRFToken` header.

### 9.2 Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Field validation failed |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Missing `Idempotency-Key` |
| 401 | `NOT_AUTHENTICATED` | No session |
| 401 | `INVALID_CREDENTIALS` | Bad login, or the user is inactive (same message, no account enumeration) |
| 403 | `PERMISSION_DENIED` | Role not allowed |
| 404 | `NOT_FOUND` | Missing, or belongs to another organization |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key with a different payload, or sent by a different user |
| 409 | `SHIFT_NOT_OPEN` | Checkout, cash refund or drawer expense without the user's open shift |
| 409 | `SHIFT_ALREADY_OPEN` | Opening a second shift |
| 409 | `SHIFT_ALREADY_CLOSED` | Closing twice |
| 409 | `PRICE_CHANGED` | `expected_total` differs from the server total |
| 409 | `REFUND_ALREADY_APPLIED` | Order already refunded |
| 409 | `PURCHASE_ALREADY_POSTED` | Re-post with a different key |
| 409 | `PURCHASE_NOT_EDITABLE` | Editing or deleting a posted purchase |
| 409 | `OPENING_BALANCE_EXISTS` | Ingredient already has movements |
| 422 | `EMPTY_CART` | No items |
| 422 | `INVALID_QUANTITY` | Quantity outside 1–99 |
| 422 | `ITEM_UNAVAILABLE` | Inactive variant, product or category |
| 422 | `INVALID_MODIFIER` | Option is inactive, not linked, has a missing slot, has no effect for the variant, or (Sprint 4 R2) is tracked but has no effects at all (`reason: no_effect`) |
| 422 | `RECIPE_MISSING` | Sprint 4 B3: a tracked variant (`track_stock = true`) has no recipe lines |
| 422 | `REGISTER_NOT_CONFIGURED` | Sprint 2: opening a shift when the café has no single default register |
| 422 | `MODIFIER_SELECTION_INVALID` | min/max violated |
| 422 | `INVALID_PAYMENT` | Duplicate method, tendered < amount, amount ≤ 0 |
| 422 | `PAYMENT_MISMATCH` | Σ payments ≠ total |
| 422 | `PARTIAL_REFUND_NOT_SUPPORTED` | `confirm_amount` ≠ total |
| 422 | `EXPENSE_NOT_VOIDABLE` | Voiding a purchase expense, an already voided one, or a drawer expense of a closed shift |
| 422 | `LAST_ADMIN` | Deactivating or demoting the last admin |
| 422 | `INVALID_RECIPE` | Recipe validation failed |
| 429 | `RATE_LIMITED` | Login throttled |

Insufficient stock is **not** an error: it returns 200/201 with `stock_warnings`.

### 9.3 Endpoint catalog

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Health check |
| GET | `/auth/csrf` | Public | Set CSRF cookie |
| POST | `/auth/login` | Public | `{username, password}` → user + session |
| POST | `/auth/logout` | A/B | End session |
| GET | `/auth/me` | A/B | Current user, role, organization settings needed by the UI (currency, timezone, language, receipt width, tax flags, business name) |
| GET, POST | `/users` | A | List or create (`username`, `password`, `role`, `display_name`) |
| PATCH | `/users/{id}` | A | `display_name`, `role`, `is_active`, `preferred_language` |
| POST | `/users/{id}/reset-password` | A | Set a new password (admin enters it); invalidates the user's sessions |
| GET, PATCH | `/settings` | GET A/B (safe subset for B), PATCH A | Organization settings |
| GET, POST | `/categories` | GET A/B, POST A | |
| PATCH | `/categories/{id}` | A | Update or deactivate |
| GET, POST | `/products` | GET A/B, POST A | GET returns variants and linked modifier groups; B sees active only. Filters: `category_id`, `search`, `is_active` (A) |
| GET, PATCH | `/products/{id}` | GET A/B, PATCH A | |
| PUT | `/products/{id}/modifier-groups` | A | Replace linked groups `[{group_id, sort_order}]` |
| POST | `/products/{id}/variants` | A | Create variant |
| PATCH | `/variants/{id}` | A | Label, price, sku, active, sort |
| GET, PUT | `/variants/{id}/recipe` | A | Read or replace the full recipe |
| GET, POST | `/modifier-groups` | GET A/B, POST A | |
| GET, PATCH | `/modifier-groups/{id}` | GET A/B, PATCH A | |
| POST | `/modifier-groups/{id}/options` | A | Option with `price_delta`, optional `variant_prices`, `effects` |
| PATCH | `/modifier-options/{id}` | A | Edit option, prices and effects (effects replaced wholesale) |
| GET, POST | `/ingredients` | A | |
| PATCH | `/ingredients/{id}` | A | Metadata only |
| GET | `/inventory/balances` | A | Filters `is_low`, `is_negative`, `search` |
| GET | `/inventory/movements` | A | Filters `ingredient_id`, `movement_type`, `from`, `to` |
| POST | `/inventory/adjustments` | A | Delta or count, with reason |
| POST | `/inventory/opening-balances` | A | Bulk opening balances |
| GET, POST | `/suppliers` | A | |
| PATCH | `/suppliers/{id}` | A | |
| GET, POST | `/purchases` | A | List or create draft |
| GET, PATCH, DELETE | `/purchases/{id}` | A | Draft only for PATCH and DELETE |
| POST | `/purchases/{id}/post` | A | Idempotent post |
| GET, POST | `/expenses` | GET A (B: own only), POST A/B | Section 8.8 |
| POST | `/expenses/{id}/void` | A | Void with reason |
| GET | `/shifts/current` | A/B | Own open shift + live totals, or null (+ `meta.last_closed`, C2) |
| POST | `/shifts/open` | A/B | `{opening_cash}` |
| POST | `/shifts/{id}/close` | Owner or A | `{actual_closing_cash, note}` |
| GET | `/shifts` | A | Filters `user_id`, `status`, `from`, `to` |
| GET | `/shifts/{id}` | Owner or A | Detail with totals, expected, actual, difference |
| POST | `/orders/quote` | A/B | No writes |
| POST | `/orders/checkout` | A/B | Idempotent atomic sale |
| GET | `/orders` | A all; B per Section 6 | Filters `from`, `to`, `status`, `cashier_id`, `shift_id`, `invoice_no` |
| GET | `/orders/{id}` | A; B if visible | Full detail with snapshots, payments, refund |
| GET | `/orders/{id}/receipt` | A; B if visible | Print-ready receipt data |
| POST | `/orders/{id}/refunds` | A/B | Idempotent full refund |
| GET | `/refunds` | A | Filters `from`, `to`, `actor_id`, `method` |
| GET | `/payments` | A | Payment ledger |
| GET | `/reports/sales-summary` | A | Section 8.13 |
| GET | `/reports/payment-breakdown` | A | |
| GET | `/reports/top-products` | A | |
| GET | `/reports/stock` | A | |
| GET | `/reports/purchases-expenses` | A | |
| GET | `/reports/shifts` | A | |
| GET | `/audit-events` | A | Filters `action`, `actor_id`, `entity_type`, `entity_id`, `from`, `to` (café-local dates). Newest first, paginated. Rows: `id, created_at, action, entity_type, entity_id, entity_label, actor{id,username,display_name}|null, summary`. `entity_label` is the record's readable name (invoice no, product and size, ingredient, user…); `meta.names` maps every id inside the page's summaries to a readable name (this café only). `meta.actions` / `meta.entity_types` list the values that exist (for the viewer's filters). Read-only (Sprint 4) |
| GET, POST | `/promotions` | GET A/B, POST A | P1 |
| PATCH | `/promotions/{id}` | A | P1 |

### 9.4 Key payloads

**Variant + recipe**

```json
POST /products/{id}/variants
{"label":"Large","sku":"LATTE-L","price":"95.00","is_active":true}
```

```json
PUT /variants/{id}/recipe
{"lines":[
  {"ingredient_id":"<coffee>","base_qty":"12.000","waste_pct":"5.00","slot_key":"coffee"},
  {"ingredient_id":"<milk>","base_qty":"250.000","waste_pct":"0.00","slot_key":"milk"}
]}
```

Response: `{"data":{"variant_id":"…","lines":[…],"warnings":[],"updated_at":"…"}}`

**Modifier group + option**

```json
POST /modifier-groups
{"name":"Milk Type","mode":"replace","replacement_slot":"milk","min_select":0,"max_select":1}
```

```json
POST /modifier-groups/{id}/options
{"label":"Oat Milk","price_delta":"15.00","is_active":true,
 "variant_prices":[{"variant_id":"<large>","price_delta":"20.00"}],
 "effects":[
   {"variant_id":"<small>","ingredient_id":"<oat>","base_qty":"180.000","waste_pct":"0.00"},
   {"variant_id":"<large>","ingredient_id":"<oat>","base_qty":"250.000","waste_pct":"0.00"}
 ]}
```

Extra Shot (an `add` group, same for all sizes):

```json
{"label":"Extra Shot","price_delta":"20.00",
 "effects":[{"variant_id":null,"ingredient_id":"<coffee>","base_qty":"8.000","waste_pct":"5.00"}]}
```

**Quote**

```json
POST /orders/quote
{"items":[{"variant_id":"<large>","quantity":1,"modifier_option_ids":["<oat>"]}]}
```

```json
{"data":{
  "subtotal":"115.00","discount_total":"0.00","tax_total":"0.00","total":"115.00",
  "items":[{"variant_id":"<large>","product_name":"Iced Latte","variant_label":"Large","quantity":1,
            "unit_price":"115.00","unit_discount":"0.00","line_total":"115.00",
            "modifiers":[{"option_id":"<oat>","label":"Oat Milk","price_delta":"20.00"}]}],
  "consumption":[{"ingredient_id":"<coffee>","name":"Coffee Beans","unit":"g","required":"12.600"},
                 {"ingredient_id":"<oat>","name":"Oat Milk","unit":"ml","required":"250.000"}],
  "stock_warnings":[{"ingredient_id":"<oat>","ingredient_name":"Oat Milk","unit":"ml",
                     "available":"100.000","required":"250.000","projected_balance":"-150.000"}]
}}
```

**Checkout** (header `Idempotency-Key: <uuid>`)

```json
POST /orders/checkout
{"items":[{"variant_id":"<large>","quantity":1,"modifier_option_ids":["<oat>"]}],
 "payments":[{"method":"cash","amount":"55.00","cash_tendered":"100.00"},
             {"method":"card","amount":"60.00","external_reference":"terminal-123"}],
 "expected_total":"115.00","note":""}
```

Response 201:

```json
{"data":{"order_id":"…","invoice_no":"POS-0000123","status":"paid",
 "subtotal":"115.00","discount_total":"0.00","tax_total":"0.00","total":"115.00",
 "payments":[{"method":"cash","amount":"55.00","cash_tendered":"100.00","change_given":"45.00"},
             {"method":"card","amount":"60.00","external_reference":"terminal-123"}],
 "change_due":"45.00","receipt_url":"/api/v1/orders/…/receipt","stock_warnings":[…]}}
```

**Refund** (header `Idempotency-Key`)

```json
POST /orders/{id}/refunds
{"reason":"Customer complaint","confirm_amount":"115.00","card_external_reference":"rf-778"}
```

```json
{"data":{"refund_id":"…","order_id":"…","invoice_no":"POS-0000012","status":"refunded","order_status":"refunded",
 "total_amount":"115.00",
 "lines":[{"method":"cash","amount":"55.00","external_reference":""},
          {"method":"card","amount":"60.00","external_reference":"rf-778"}],
 "shift_id":"…","inventory_restored":false}}
```

`order_status` and `status` carry the same value (Q6 item 1B, owner 2026-11-11: the spec name is sent and `status` is kept for the screens). `shift_id` is the refunding user's shift the refund was recorded on.

**Shift**

```json
POST /shifts/open
{"opening_cash":"300.00"}
```

```json
POST /shifts/{id}/close
{"actual_closing_cash":"1290.00","note":"End of shift"}
```

Close response — the same shift object as `GET /shifts/current` and `GET /shifts/{id}` (Q6 item 2A, owner 2026-11-11). For a closed shift `totals` is the snapshot frozen at close:

```json
{"data":{"id":"…","status":"closed","opening_cash":"300.00","opened_at":"…","closed_at":"…",
 "closed_by":{"id":"…","display_name":"…"},"user":{"id":"…","display_name":"…"},"register":"Main",
 "expected_cash":"1300.00","actual_cash":"1290.00","difference":"-10.00","close_note":"End of shift",
 "totals":{"cash_sales":"1250.00","card_sales":"400.00","cash_refunds":"50.00","card_refunds":"0.00",
           "drawer_expenses":"200.00","orders_count":42,"expected_cash":"1300.00"}}}
```

`GET /shifts/current` with no open shift returns `{"data": null, "meta": {"last_closed": {"id","closed_at","actual_cash"} | null}}` — the user's own last close, shown as information on the open-shift popup (C2, owner 2026-11-11).

**Purchase**

```json
POST /purchases
{"supplier_id":"…","supplier_invoice_no":"INV-102","purchased_on":"2026-11-10",
 "payment_method":"cash","source":"external","notes":"",
 "items":[{"ingredient_id":"<milk>","qty":"12000.000","unit_cost":"0.0450",
           "pack_label":"1L carton","pack_count":"12","pack_size":"1000.000"}]}
```

Response: `status: "draft"`, `total: "540.00"` (computed by the server).

`POST /purchases/{id}/post` returns `status: "posted"`, `stock_movement_ids`, and `expense_id`.

**Expense**

```json
POST /expenses
{"category":"supplies","description":"Ice bags","amount":"40.00"}
```

As a Barista, source, method and shift are set by the server. As an Admin, you may pass `payment_method`, `source`, and `paid_at`.

**Receipt data** (`GET /orders/{id}/receipt`)

```json
{"data":{
  "business":{"name":"Drip Café","header":"…","footer":"…","tax_registration_number":""},
  "invoice_no":"POS-0000123","created_at":"…","cashier":"barista1",
  "items":[{"name":"Iced Latte","variant":"Large","quantity":1,"modifiers":["Oat Milk"],"unit_price":"115.00","line_total":"115.00"}],
  "subtotal":"115.00","discount_total":"0.00",
  "tax":{"enabled":false,"label":"VAT","rate":"0.00","inclusive":true,"amount":"0.00"},
  "total":"115.00",
  "payments":[{"method":"cash","amount":"55.00","cash_tendered":"100.00","change_given":"45.00"},{"method":"card","amount":"60.00"}],
  "refund":null,
  "paper_width":"80mm","currency":"EGP"
}}
```

---

## 10. Frontend specification

### 10.1 General

- **Responsive breakpoints** (the existing design system may adjust them):
  - phone < 640px
  - tablet 640–1024px
  - desktop > 1024px
- **Touch:** targets ≥ 44px. No hover-only interactions.
- **Every network action has explicit states:** loading, success, error. Error states show the translated error code.
- **Route guards:** unauthenticated users go to `/login`. Barista on an admin route sees a 403 page. This is UX only; the backend enforces.
- **API client:**
  - Handles CSRF, envelope unwrapping and error parsing.
  - 401 redirects to login.
  - Generates and attaches `Idempotency-Key` where required.
- **Keyboard shortcuts (Sprint 4 B2, owner request):** one list in `frontend/src/lib/shortcuts.ts`, shown by `?`. Keys match the physical key (same with the Arabic layout), do not fire while typing (except Esc, Ctrl+Enter, F-keys), and only the top popup's shortcuts fire. Browser-reserved keys (Alt+D, F1, F3, F5–F7, F10–F12, Ctrl/Alt+digits) are not used.

### 10.2 POS screen (`/pos`) — the most important screen

- **Layout:**
  - Tablet and desktop: product area on the left, cart panel on the right (logical start/end so RTL flips it).
  - Phone: full-screen products, cart as a bottom sheet with a sticky total and checkout button.
- **Top bar:** search, category tabs, current shift badge, user menu.
- **Shift gate:** if `GET /shifts/current` is null, show an "Open shift" dialog with opening cash. Selling is disabled until a shift is open. **Sprint 4 B1 (owner):** the dialog can be closed (✕, Esc, Cancel); the POS then stays visible but locked (products greyed, cart and Pay disabled) and the shift bar has an "Open shift" button that reopens it.
- **Adding items:**
  - Tapping a product opens a sheet with a variant picker (sizes with prices) and modifier groups (radio for max=1, checkboxes otherwise, min/max enforced in the UI too).
  - Quantity stepper. Add to cart.
- **Cart:**
  - Lives on the client, with sessionStorage backup.
  - Change quantity, remove a line, edit a line (reopens the sheet).
  - On every cart change, call `/orders/quote` (debounced about 300ms). Show server totals only.
  - Show the stock warnings banner: non-blocking, listing each ingredient short.
- **Payment dialog:** tabs Cash / Card / Mixed.
  - **Cash:** quick-amount buttons (exact, next 50, next 100, 200), tendered input, change shown.
  - **Card:** optional terminal reference, with the note "Charge the card on the terminal first".
  - **Mixed:** cash amount input, card = remainder, tendered and reference fields.
  - The confirm button is disabled until the amounts are valid.
- **Checkout reliability:**
  1. Generate the idempotency key when the payment dialog is confirmed. Store `{key, payload}` in sessionStorage until a definitive response.
  2. On a network failure, a timeout or a 5xx answer, show "Checking payment status…" and retry the **same** request with the **same** key (up to 3 times with backoff). Then show "Could not confirm — check connection, then tap Retry". Retry reuses the same key.
  3. Never create a new key for an unresolved sale.
  4. On `PRICE_CHANGED`, show the old vs new total and require reconfirmation, which sends a new request with a new key.
- **Success screen:**
  - Invoice number, total, change due.
  - Buttons: **Print receipt**, **New order**.
  - The cart clears only after success.
- **Drawer expense:** a "Pay from drawer" action in the shift menu opens an expense form (category, description, amount).

### 10.3 Receipt and printing (`/orders/:id/receipt`)

- Dedicated print view rendered from the receipt endpoint.
- `@media print` CSS; hide app chrome.
- Paper width = this device's choice (localStorage, wrapped in try/catch) else the Settings default. Options: 58mm, 76mm, 80mm, 112mm, A4. A width picker on the receipt screen sets it for the device.
- Monospace-friendly layout: business header, invoice no and date (local timezone), cashier, items with modifiers indented, subtotal, discount, tax lines when enabled, total, payment breakdown, change.
- Show a large **REFUNDED** banner and the refund date when refunded. Show **REPRINT** on reprints.
- The Print button calls `window.print()`.

### 10.4 Orders (`/orders`)

- **List:**
  - Admin: date range filters.
  - Barista: today's orders plus an invoice number search.
- **Detail:** items, modifiers, payments, status, refund info. Actions: Reprint, Refund.
- **Refund dialog:**
  - Shows the order total and the allocation preview (cash X, card Y).
  - Required reason.
  - Optional card refund reference.
  - Warning text: card refunds must be done on the terminal; stock is not returned.

### 10.5 Shift (`/shift`)

- Current shift summary: opening cash, cash sales, card sales, refunds, drawer expenses, expected cash so far.
- Close shift: actual cash input. After closing, show expected, actual and difference, with a print-friendly shift report.
- Admin: shifts list, any shift's detail, and close another user's open shift.

### 10.6 Admin area (`/admin/...`)

- **Dashboard:** today's sales summary, payment split, low/negative stock count, open shifts.
- **Catalog:**
  - Categories CRUD.
  - Products with an inline variants table.
  - Per-variant recipe editor: ingredient picker, base qty, waste %, slot key, with a live "consumption per unit" preview.
  - Linked modifier groups.
- **Modifiers:**
  - Groups CRUD.
  - Options with a per-variant price override table.
  - Effects editor: an "All sizes" row plus per-size rows.
  - Validation messages for missing slots.
- **Inventory:**
  - Balances (low/negative highlighted).
  - Movements ledger with filters.
  - Adjustment form (delta or count).
  - Opening balances bulk form.
- **Suppliers and purchases:**
  - Draft editor with pack helper (`pack_count × pack_size` = qty, cost per pack → unit cost).
  - Post confirmation (posting is irreversible).
- **Expenses:** list, create, void.
- **Users:** list, create, deactivate/reactivate, reset password, change role.
- **Reports:** one page per report with a date-range picker (local dates), totals cards and tables.
- **Audit log:** readable for non-technical users (owner, 2026-11-11): each event is a translated sentence (When · Who · What happened · Details); opening a row shows labelled details and Before → After changes. No JSON, no technical action names, no bare ids. Filters: What happened (grouped by area), Who, dates. Record pages link to it ("History").
- **Settings:** business name, receipt header/footer, paper width, invoice prefix (warn if sales already exist), tax settings.

### 10.7 Existing frontend reuse

- Keep the visual design, layout patterns and components from the owner's React app.
- Replace all calls to the old Node backend with the new API client.
- Map existing screens to Section 10 in the Sprint 0 audit.
- Missing screens are built in the same design language.

---

## 11. Sprint plan

Days are guidance for a 14-day schedule. Each sprint ends with a STOP for owner testing.

### Sprint 0 — Audit and bootstrap (≈ half day)

**Tasks:**
1. **Audit the existing frontend.** Write `docs/sprints/sprint-0-audit.md` covering:
   - framework and build tool, TS vs JS, routing, state management, UI kit and styling approach;
   - list of existing screens mapped to Section 10, and what is missing;
   - all current API calls, the old backend's shape, and anything reusable as reference;
   - risks.
2. Propose the repo restructure (Section 4.3).
3. Create `CLAUDE.md` and `docs/PROGRESS.md` (Section 0.2).
4. Bootstrap the backend:
   - Django project with split settings, env config and Postgres via docker-compose.
   - **Custom User model before any migration.**
   - `core` app with the envelope renderer, exception handler, `money.py`, and the `/health` endpoint.
   - `pytest` setup; ruff.
5. Frontend dev proxy `/api` → Django. Install i18n and react-query if missing (do not restructure the UI yet).
6. CI workflow running the full check suite (Section 4.4).

**Exit criteria:**
- `docker compose up` gives a working DB.
- `GET /api/v1/health` returns ok through the frontend dev proxy.
- CI is green.

**STOP:** present the audit and the restructure proposal. Wait for approval before Sprint 1.

### Sprint 1 — Foundation and master data (Days 1–3)

**Backend:**
- **Core:**
  - `TenantModel` and the tenant-scoped mixin.
  - Policy module.
  - Audit service and model.
  - Idempotency module (with unit tests, even if first used in Sprint 2).
  - Time utilities.
- **Tenancy:** models, seed, `/settings`.
- **Accounts:**
  - Auth endpoints (csrf, login with throttling, logout, me).
  - Users management with the `LAST_ADMIN` rule.
  - Session invalidation on deactivation and password reset.
- **Catalog:** categories, products, variants, product↔modifier-group links (groups themselves come in Sprint 2).
- **Inventory:**
  - Ingredients with auto `StockBalance`.
  - Movements (append-only).
  - Adjustments (delta and count).
  - Opening balances.
  - Balances and movements endpoints.
- `seed_demo` management command: demo users (1 admin, 2 baristas), Iced Latte with Small/Large/XL, about 6 ingredients. Dev only.

**Frontend:**
- API client, i18n setup with `en.json` and `ar.json` skeleton, `dir` handling.
- Login and logout, role-based route guards, responsive app shell.
- Admin: categories, products and variants, ingredients, balances and movements, adjustments, opening balances, users, settings.

**Tests (minimum):**
- **AT-01:** create Iced Latte with 3 sizes and prices.
- **Permissions:** a parametrized permission test for every endpoint so far.
- **Tenancy isolation:** two organizations.
- **Auth:** a deactivated user cannot log in and their sessions are rejected.
- **Ledger and stock:**
  - `StockMovement` update/delete raises.
  - Adjustment requires a reason.
  - Count computes the correct delta.
  - Opening balance is rejected when movements exist.
  - Ingredient PATCH ignores or rejects balance fields.
- **Users:** the last-admin rule.

**Owner manual test checklist:**
- [ ] Log in as admin and as barista. The barista cannot reach admin pages or call admin APIs.
- [ ] Create a category, a product, and 3 sizes with different prices. Deactivate a size.
- [ ] Create ingredients in g, ml and pcs. Enter opening balances. Do an adjustment and a physical count. See the movements ledger.
- [ ] Create, deactivate and reactivate a user. A deactivated user cannot log in.
- [ ] The app looks right on phone, tablet and desktop widths.

**STOP.**

### Sprint 2 — End-to-end sale (Days 4–7)

**Backend:**
- Recipes (`PUT`/`GET` with validation and warnings).
- Modifier groups, options, per-variant prices, effects, product links.
- Shifts: open, current (close comes in Sprint 3; you may implement it early if convenient).
- Pricing and consumption engines (pure, heavily unit-tested).
- Quote.
- Checkout:
  - idempotency;
  - invoice counter;
  - payments;
  - stock deduction under lock;
  - snapshots;
  - audit.
- Orders list and detail with Barista visibility rules.
- Receipt endpoint.

**Frontend:**
- Recipe editor and modifier admin.
- Full POS screen (Section 10.2) with shift gate, payment dialog, reliability flow, and success screen.
- Receipt print view (58/80/A4).
- Orders list and detail with reprint.

**Tests (minimum):**
- **Recipes and modifiers:**
  - AT-02: Small and Large consume differently.
  - AT-03: 12 g + 5% gives 12.600, waste applied once.
  - AT-04: Oat Milk replaces milk; regular milk is not deducted.
  - AT-05: Extra Shot adds price and coffee.
  - Min/max modifier validation.
  - Missing slot.
  - Option with no effect for the variant.
- **Selling and payments:**
  - AT-06: sale with shortage succeeds with a warning and the balance goes negative.
  - AT-07, AT-08, AT-09: cash, card, and mixed 80 + 120 = 200.
  - Payment validation errors leave no order and no stock change.
- **Integrity:**
  - AT-10: `PRICE_CHANGED`.
  - AT-11: same key twice gives one order and one set of movements; same key with a different payload gives 409.
  - AT-12: **concurrent checkouts** (threads with `transaction=True` DB tests) leave the exact balance with no lost update.
  - AT-13: a recipe edit after a sale leaves the old snapshot unchanged.
  - Checkout without a shift gives 409.
  - Invoice numbers are gapless across a failed checkout.

**Owner manual test checklist:**
- [ ] Configure Iced Latte recipes per size, a Milk Type replace group (Oat Milk), and an Extras add group (Extra Shot).
- [ ] As a barista, open a shift and sell Large + Oat + Extra Shot. Check the price, then check the stock movements (no regular milk deducted).
- [ ] Sell something with insufficient stock: a warning appears, the sale succeeds, and the balance goes negative.
- [ ] Pay cash with change, card only, and mixed.
- [ ] Print the receipt on your printer at 58 mm or 80 mm. Reprint from history.
- [ ] Use the POS on a phone.

**STOP.**

### Sprint 3 — Daily operations (Days 8–10)

**Backend:**
- Shift close and reconciliation; shifts list and detail.
- Refunds (allocation, shift rules, audit); refunds and payments ledgers.
- Suppliers; purchases (draft, edit, delete draft, idempotent post creating movements and one expense).
- Expenses (Admin and Barista rules, void).
- All six reports.
- ~~Audit events endpoint~~ — moved to Sprint 4 (owner, 2026-11-10).

**Frontend:**
- Shift page and close flow; admin shifts.
- Refund dialog.
- Barista "Pay from drawer".
- Purchases with the pack helper.
- Expenses.
- Reports pages.
- ~~Audit log viewer~~ — moved to Sprint 4 (owner, 2026-11-10).
- Dashboard.

**Tests (minimum):**
- **Refunds:**
  - AT-14: refund with reason; the original invoice is intact and status becomes refunded.
  - AT-15: refund twice (same key gives a replay; a new key gives 409).
  - Mixed-order refund allocation.
  - Cash refund without an open shift gives 409.
  - The partial amount is rejected.
- **Purchases:** AT-16: post twice gives stock +1× and cost +1×. A draft is editable; a posted purchase is not.
- **Shifts and expenses:**
  - AT-17: a drawer expense reduces expected cash.
  - AT-18: close stores expected, actual and difference.
  - Close twice gives 409.
  - A barista expense is forced onto their own shift.
  - A voided expense is excluded.
- **Reports:**
  - AT-22: a scenario fixture (several sales across methods, a refund, a purchase and expenses) where every report reconciles. Assert the invariants in Section 8.13.
  - Report date boundaries in the Cairo timezone.

**Owner manual test checklist:**
- [ ] Two baristas each open their own shift, sell, and close. Check expected vs actual vs difference.
- [ ] Refund a cash order and a mixed order as a barista. Check the reason in the audit log and the effect on that barista's shift.
- [ ] Barista pays for ice from the drawer; the shift's expected cash drops.
- [ ] Admin creates a purchase (12 × 1 L milk) and posts it. Stock goes up once and the expense appears once. Posting again does nothing.
- [ ] Reports for today match what you did.

**STOP.**

### Sprint 4 — Stabilization (Days 11–12)

- **Playwright E2E:**
  - login;
  - open shift → sale with modifiers → mixed payment → receipt;
  - refund;
  - purchase post;
  - shift close;
  - a barista blocked from admin.
- **Audit log:** `GET /audit-events` and the admin viewer (moved here from Sprint 3 by the owner, 2026-11-10).
- **Permission sweep:** every endpoint × role. Confirm no admin data leaks in barista responses (e.g. ingredient costs).
- **Network-failure UX (AT-20):**
  - simulate a timeout after the server commits;
  - confirm the retry with the same key gives no duplicate;
  - confirm a clear error when offline.
- **Responsive QA** on phone, tablet and desktop for POS, orders, shift and receipt.
- **Print CSS QA** for 58, 80 and A4.
- **i18n coverage check:**
  - no hardcoded strings (add a lint rule or script if practical);
  - RTL smoke test with `dir="rtl"`.
- **Performance sanity:** with seed data, quote and checkout under ~2 s locally. Add needed indexes and `select_related`/`prefetch_related`.
- Fix all owner-reported bugs from Sprints 1–3.
- **P1 promotions only if** everything above is green and the owner agrees.

**Exit criteria:** no critical or high bugs, all ATs automated where possible, CI green.

**STOP.**

### Sprint 5 — Release readiness (Days 13–14)

- **`docker-compose.prod.yml`:**
  - reverse proxy with HTTPS (Caddy recommended for automatic certificates, or nginx + certbot) serving the built frontend and proxying `/api` on the same origin;
  - gunicorn backend;
  - Postgres with a volume;
  - backup service.
- **Production settings hardening** (Section 5.9), `collectstatic`, and migrations on deploy.
- **Backups:**
  - daily `pg_dump` (custom format) with 14-day retention (configurable);
  - `ops/restore.sh`;
  - `docs/BACKUP_RESTORE.md`;
  - **an actual restore test into a fresh DB, documented (AT-23)**.
- **Real-data import:** a management command `import_catalog <file.xlsx|csv>` for categories, products, variants, ingredients, recipes and opening balances, with a template file and a dry-run mode. Customer data is about 20 products.
- **Docs:**
  - `README.md` (dev setup);
  - `docs/OPERATIONS.md` (deploy, update, logs, user creation and deactivation, receipt reprint);
  - `docs/USER_GUIDE.md` (barista and admin quick guides).
- Tag release `v1.0.0`.

**Owner tasks (human, not automated):**
- AT-21 printer test on the café's real device and paper.
- Enter the real catalog and opening stock.
- AT-24 hands-on UAT with café staff.
- Hosting and domain.
- Go/No-Go (Section 13).

**STOP.**

---

## 12. Acceptance tests

| ID | Scenario | Expected | Sprint |
|---|---|---|---|
| AT-01 | Admin creates Iced Latte with 3 sizes | Different prices, no code change | 1 |
| AT-02 | Small vs Large recipes | Different consumption recorded | 2 |
| AT-03 | 5% waste on 12 g | Exactly 12.600 g, applied once | 2 |
| AT-04 | Oat Milk replaces Regular Milk | Only oat deducted | 2 |
| AT-05 | Extra Shot | Extra price and extra coffee | 2 |
| AT-06 | Sell with shortage | Warning, success, auditable negative balance | 2 |
| AT-07 | Cash only | One cash payment, correct receipt and change | 2 |
| AT-08 | Card only | One card payment, reference if given | 2 |
| AT-09 | Mixed 80 cash + 120 card | Total 200, method reports reconcile | 2 / 3 |
| AT-10 | Price changed after quote | 409, reconfirm, no wrong charge | 2 |
| AT-11 | Same checkout key twice | One order, one set of deductions | 2 |
| AT-12 | Concurrent sales on the same ingredient | No lost update | 2 |
| AT-13 | Recipe edited after a sale | Old snapshot unchanged | 2 |
| AT-14 | Barista refunds with reason | One audited refund, invoice intact | 3 |
| AT-15 | Refund twice | No duplicate payout | 3 |
| AT-16 | Purchase posted twice | Stock and cost once | 3 |
| AT-17 | Drawer expense | Expected cash decreases | 3 |
| AT-18 | Close shift | Expected, actual and difference stored | 3 |
| AT-19 | Barista calls an admin API | 403, no side effects | 1–4 |
| AT-20 | Connection lost during checkout | No phantom or duplicate sale after retry | 4 |
| AT-21 | Real printer | Legible receipt, invoice no visible | Owner |
| AT-22 | Report reconciliation | All figures consistent | 3 |
| AT-23 | Backup and restore | Restored data queryable | 5 |
| AT-24 | Customer UAT with real data | Customer accepts | Owner |
| AT-25 | Tenant isolation | Organization B never sees organization A data | 1 |
| AT-26 | Tax enabled (inclusive and exclusive) | Correct tax_total and total; receipt shows tax | 2 |

---

## 13. Definition of Done and Go-Live

### 13.1 Feature DoD

A feature is done only when:
1. Its acceptance criteria pass.
2. Backend and frontend are integrated.
3. Validation and permissions are enforced on the backend.
4. Automated tests exist and pass in CI.
5. Migrations are reviewed (no destructive surprises).
6. Failure cannot leave partial data.
7. The OpenAPI schema is up to date.
8. A manual test is done and noted in the sprint report.

### 13.2 Go-Live gate (owner decides)

1. All P0 items pass on the café's real device, including printing.
2. Retry and concurrency tests pass for checkout, refund and purchase post.
3. Cash, card, mixed, shifts and reports reconcile.
4. Permissions are verified through the API.
5. HTTPS, production secrets, backups with a tested restore, and error logging are in place.
6. The real catalog, recipes and opening stock are entered and verified.
7. Docs are delivered and the release is tagged.
8. The customer has completed UAT.

Any unresolved issue affecting payment collection, financial integrity, security, or legally required receipt content is a **No-Go**: run a supervised pilot only.

---

## 14. Open items (defaults applied — owner to confirm)

| Item | Default implemented | Where to change |
|---|---|---|
| D9 Mixed-payment refund allocation | **Confirmed (2026-11-10):** back to the original methods and amounts | `sales/services.py::allocate_refund` |
| D10 Barista drawer expenses | **Confirmed (2026-11-10):** allowed, forced to own open shift | `core/policy.py` + `expenses/services.py` |
| D17 Card terminal reference | **Confirmed (2026-11-10):** optional | Serializer flag |
| Tax pricing default | **Owner (2026-11-10): tax added on top** (`prices_include_tax=False`), tax disabled until the Admin enables it and types the rate | `OrganizationSettings` |
| Barista order visibility | Today's orders (all cashiers) + exact invoice lookup | `sales/selectors.py` |
| Hosting / domain | Generic Linux VPS with Docker | Sprint 5 |

Record any answer from the owner in `docs/PROGRESS.md`, and update this table in the same commit.
