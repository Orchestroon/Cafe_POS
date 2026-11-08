# Sprint 0 audit

Scope note: per owner instruction, `legacy/js/app.js` and `legacy/js/store.js` were **not read**. This audit is based on `legacy/index.html`, `legacy/css/style.css` (header and tokens), `legacy/README.md`, the Docker/nginx files and file sizes.

## 1. Existing frontend
| Aspect | Finding |
|---|---|
| Framework / build | None. Vanilla HTML + ES modules, no bundler. Served by nginx (Docker) or `npx serve`. |
| TS vs JS | Plain JS (`app.js` 4,338 lines, `store.js` 1,455 lines). |
| Routing | A `data-view` attribute on nav links; a single `#view-content` section is rendered by JS. No URL router. |
| State | In-memory store persisted to `localStorage` (per README). No server. |
| UI kit / styling | Hand-written CSS (`style.css`, 2,883 lines) with design tokens on `:root`: Growl Tech Nightshade `#000823`, Strong Orange `#FF7A00`, Orange Tint `#FCCA9C`, White Tech `#F8F8F8`; Instrument Sans + JetBrains Mono; radii 6/10/14px; 250px sidebar. |
| Layout shell | `.sidebar` (brand header, workspace selector, `.nav-menu`, footer with user badge), `.top-bar` (menu button, breadcrumbs, clock, icon buttons), `.view-container`, `#modal-container`, `.mobile-bottom-nav` (5 buttons, phones), drawer backdrop. |
| i18n / RTL | None. CSS uses physical left/right properties; to convert to logical properties as styles are ported. |
| PWA | Meta tags only (no manifest or service worker in the repo). |

## 2. Existing screens mapped to spec §10
| Legacy screen (`data-view`) | Spec target | Notes |
|---|---|---|
| Operations overview (`overview`) | `/admin` dashboard (10.6) | Sprint 3/4 data (sales, low stock, shifts). |
| Barista POS (`pos`) | `/pos` (10.2) | Sprint 2. Legacy has order types and outside-event tagging: not in spec. |
| Outside events (`events`) | — | **Out of scope for v1** (not in §10). Do not build. |
| Inventory & warehouses (`inventory`) | `/admin/inventory` (10.6) | Sprint 1. Legacy is multi-warehouse with transfers: spec v1 has one default Location. |
| Products & recipes (`recipes`) | `/admin/catalog` (10.6) | Categories/products/variants Sprint 1; recipes Sprint 2. |
| Suppliers & receiving (`suppliers`) | `/admin/purchasing` | Sprint 3. |
| Sales invoices & payments (`invoices`) | `/orders` (10.4) | Sprint 2/3. Legacy "rectify/modify" flow conflicts with "paid orders are never edited" (§5.4): only full refund. |
| Team & permissions (`team`) | `/admin/users` (10.6) | Sprint 1. Legacy has Owner/Admin/Barista and a toggle matrix; spec has two fixed roles (§6). |
| Admin settings (`settings`) | `/admin/settings` | Sprint 1. |
| Cashier sign-in / session open/close (README) | Login + `/shift` (10.5) | Sprint 1 (login), Sprint 2/3 (shift). |

**Missing in legacy:** login page, 403 page, receipt/print view, expenses, reports, audit log, modifiers admin, ledger/adjustments/opening balances UI, RTL/Arabic.

## 3. API calls and old backend
- There is **no old backend**: all data is client-side (`localStorage`). No API calls exist to map; `legacy/js/*` stays untouched and unread.
- Reusable as reference only: visual design, layout patterns, icon SVGs inline in `index.html`.

## 4. Repo restructure (approved by owner, executed in Sprint 0)
```
legacy/    old static app (read-only reference; its Docker/nginx files kept inside)
backend/   Django 5.2 + DRF (Python 3.12, Docker)
frontend/  Vite + React 18 + TypeScript (logo/favicon copied to public/)
docs/ .github/workflows/ci.yml docker-compose.yml .env.example
```
`ops/` (backup, proxy) is deferred to Sprint 5.

## 5. Risks
1. **Python version:** host has 3.10.12, spec requires 3.12+. Backend therefore runs only in Docker (`python:3.12-slim`); IDE tooling on the host won't see the deps.
2. **Port clashes on the dev machine:** 5432 and 8000/8001 are used by other projects. Compose uses DB host port 5433 and `BACKEND_PORT` (default 8000) is overridable.
3. **Legacy scope creep:** the prototype has features outside v1 scope (events, multi-warehouse transfers, order editing, 3 roles). They must not be ported.
4. **RTL debt:** the legacy CSS uses physical properties; porting must convert them, otherwise Arabic layouts break.
5. **UUID PKs + custom User** are fixed in the very first migration. Changing either later is painful; they follow the spec.
6. **Security of throttling:** login throttling per IP and username needs a shared cache if more than one gunicorn worker is used (default locmem cache is per process). Decide in Sprint 1.
