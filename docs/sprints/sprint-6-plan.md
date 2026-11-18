# Sprint 6 plan — Release readiness

> **Superseded (owner, 2026-11-18).** Sprint 6 was re-scoped to **Promotions** and **production readiness** (Caddy stack, hardened settings, `create_admin`, backups and restore test, react-router v7, self-hosted fonts, `legacy/` removal). What was built, decided and checked is in `docs/sprints/sprint-6-report.md`. **Deferred, not built:** tasks 5 (`import_catalog`), 6-8 where they concern the import and the user guide (`USER_GUIDE.md`), the `v1.0.0` tag, and the platform super-admin console. This file is kept as the original draft for the deferred items.

Read: CLAUDE.md, PROGRESS.md, sprint-4-report, spec §4.4, §5.9, §11 (Sprint 6), §12 (AT-21, AT-23, AT-24), §13, §14 (hosting).

Status: **draft, not started.** Moved from Sprint 5 to Sprint 6 by the owner (2026-11-17): Sprint 5 is now the logic review and fixes. This plan is re-checked after Sprint 5, because the import (task 5) and the user guide (task 8) follow the fixed logic. No code until the owner says "approved, start".

Branch: `sprint-6-release` from `main`, after Sprint 5 is approved and committed.

## What exists today (checked 2026-11-17)
- `backend/Dockerfile` already ends with `gunicorn config.wsgi`, but it installs the **dev** extras (pytest, ruff…) into the image.
- `config/settings/prod.py` has DEBUG off, secure cookies, SSL redirect and the proxy SSL header. `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `SECRET_KEY`, `DATABASE_URL`, `NUM_PROXIES` already come from the environment. JSON logging is already in `base.py`. Swagger/schema is already off when DEBUG is off.
- No Django admin and no static-file app, and the API only renders JSON. **`collectstatic` has nothing to collect**, so it is skipped (assumption 3).
- No way to create the first Admin in production: `seed_demo` is dev-only and `seed_org` creates only the café.
- `.env.example` exists (dev only). No `ops/` folder, no prod compose file, no backups.

## Questions for the owner
| # | Topic | Proposal (default if you agree) |
|---|---|---|
| Q1 | ~~D20~~ | Answered (owner, 2026-11-17): D20 is part of Sprint 5 (logic review and fixes). |
| Q2 | Hosting and domain | Do you have a VPS and a domain yet? If not, I build everything for a **generic Linux VPS with Docker** (spec §14), with the domain in `.env`. It is tested locally with `localhost` and Caddy's own local certificate. The real HTTPS certificate is issued on the first start on the server, once the domain points to it. |
| Q3 | Reverse proxy | **Caddy** (the spec's recommendation): automatic HTTPS and renewal, one short config file, and it serves the built frontend itself. No nginx or certbot. |
| Q4 | Import file format | One **.xlsx template** with one sheet each for categories, products+sizes, ingredients, recipes and opening stock. The same columns are also accepted as a **folder of CSV files**. This needs one new backend dependency, `openpyxl`. Alternative: CSV only, with no new dependency, but five files to fill in. Which one? |
| Q5 | Backups | Daily `pg_dump` at 03:00 café time, kept 14 days (configurable), stored in `./backups` on the server. **Copying them off the server is your job** (rsync, a cloud drive…). A backup that lives only on the same server is lost with the server. Do you want an off-site copy built in (that needs a target: S3, another server…)? |
| Q6 | Error logging (Go-Live gate item 5) | Keep the JSON logs from `docker compose logs` (already in place), with a documented `grep` for errors and log rotation set in compose. **No Sentry** or other outside service. OK? |
| Q7 | First Admin on the server | New command `create_admin` (asks for a username and a password and checks it with the password rules, idempotent, refuses if an Admin already exists unless `--force`). It runs after `seed_org`. |
| Q8 | User guide language | `docs/USER_GUIDE.md` in **English and Arabic** (two files) because the staff use the Arabic UI. Or English only? |
| Q9 | `v1.0.0` tag | I tag `v1.0.0` only after you approve the sprint. Your owner tasks (AT-21 printer, AT-24 UAT, Go/No-Go) can come after the tag as `v1.0.x` fixes. Or do you want the tag only after UAT? |
| Q10 | Commits | Same rule as before: **no commits until you approve**, then descriptive commits (body lists everything done and every fix), then push. |
| Q11 | Open items from Sprint 4 | react-router v7 upgrade (`npm audit`): I propose it **goes into this sprint** (it is a security advisory and the E2E suite covers it). S3 and the logic items are in Sprint 5. |

## Assumptions (they go into the report's Deviations if they hold)
1. One café per server (v1 is single-branch). Multi-tenant hosting is out of scope.
2. The production stack runs from the repo on the server (`git pull` + `docker compose -f docker-compose.prod.yml up -d --build`). No image registry and no CI deploy.
3. `collectstatic` is skipped because there are no Django static files (see above). If a static app is ever added, the Dockerfile step is one line.
4. The import is **create-only and all-or-nothing**: one transaction, with `--dry-run` printing what would be created and every error with its sheet and row. It refuses names that already exist (no silent update). It writes audit events and opening balances through the existing services (same ledger rules as the screens).
5. No new business rules. Any change to spec behavior updates the spec in the same commit.

## Tasks

### Production stack
- [ ] **1 `docker-compose.prod.yml`**
  - `db`: postgres:16, named volume, not published on any host port, healthcheck.
  - `backend`: same Dockerfile with a build arg so the prod image has **no dev extras**. Runs as a non-root user. On start: `migrate --noinput` → `createcachetable` → gunicorn (worker count from env, default `2*CPU+1`, access log to stdout). `DJANGO_SETTINGS_MODULE=config.settings.prod`, `NUM_PROXIES=1`. Healthcheck on `/api/v1/health`. `restart: unless-stopped`.
  - `web`: Caddy with a multi-stage build (node builds `frontend/dist`, Caddy serves it). Proxies `/api/*` to the backend on the same origin, falls back to `index.html` for the SPA routes, gzip/zstd, long cache for hashed assets and no cache for `index.html`. Ports 80/443 and a volume for certificates.
  - `backup`: see task 3.
  - Log rotation (`json-file`, size/count limits) on every service.
- [ ] **2 Production settings hardening (§5.9)**
  - `prod.py`: HSTS (`SECURE_HSTS_SECONDS`, starting at 1 day with an env switch to raise it), `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS=DENY`, `SECURE_REFERRER_POLICY`, `SESSION_COOKIE_AGE` kept as today. Refuse to start if `SECRET_KEY` is short or looks like a dev key, or if `ALLOWED_HOSTS` is empty.
  - Caddy sets a strict Content-Security-Policy for the SPA (self only, plus Google Fonts if the Cairo/Instrument Sans fonts load from there; checked in the browser).
  - `.env.prod.example` lists every variable with a comment (`DOMAIN`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `BACKUP_KEEP_DAYS`, `BACKUP_TIME`, `GUNICORN_WORKERS`). `.gitignore` covers `.env*` except the examples, plus `backups/`.
  - Test: `manage.py check --deploy` with prod settings shows no warnings (run in CI). A pytest checks that `/api/v1/schema/` and `/api/v1/docs/` return 404 in prod and that health exposes nothing beyond `status`/`db`.
- [ ] **3 Backups (AT-23)**
  - `backup` service: postgres:16 image plus a small shell loop that runs `pg_dump -Fc` daily at `BACKUP_TIME`, writes `backups/drip-YYYYMMDD-HHMM.dump` atomically (temp file, then rename), deletes dumps older than `BACKUP_KEEP_DAYS`, and logs one JSON line per run. A failed dump leaves the old ones in place and logs an error.
  - `ops/backup-now.sh`: one manual backup (also used before every update).
  - `ops/restore.sh <dump> [--into <db>]`: restores into a **fresh database**. It refuses to overwrite the live DB unless `--replace` is given; `--replace` stops the backend, takes a safety dump first, restores, then runs migrate and starts the backend.
  - **AT-23, automated:** `ops/test-restore.sh` brings up the prod stack locally, creates data (seed_org + create_admin + a sale through the API), dumps it, restores into a new DB, and checks row counts and one order total match. It runs in a new **`ops` CI job**.
  - **AT-23, manual:** I run it once by hand and paste the output into the report.
  - `docs/BACKUP_RESTORE.md`: where backups are, how to copy them off the server, how to restore (fresh DB / replace), how to test a restore monthly.
- [ ] **4 First setup commands**
  - `create_admin` (Q7), with tests: validators, idempotency, `--force`, audit event.
  - `ops/first-run.sh`: checks `.env`, starts the stack, waits for health, runs `seed_org` and `create_admin`. Safe to re-run.

### Real-data import
- [ ] **5 `import_catalog <file.xlsx | folder>` [--dry-run]**
  - Sheets/files: `categories` (name, sort), `products` (category, product, size, price, active, track_stock), `ingredients` (name, base_unit, cost), `recipes` (product, size, ingredient, qty, waste_pct), `opening_stock` (ingredient, qty).
  - Validates everything first: unknown references, duplicate rows, bad numbers/units, sizes without a recipe and `track_stock=true` (B3 rule), and negative or zero opening quantities. Errors are reported as `sheet:row: message`. Nothing is written if there is any error.
  - Writes through the existing services (`save_setup`, `create_ingredient`, opening-balance service) inside one transaction, under one café (`--org` slug, default the single café), recorded as the Admin given in `--user`.
  - `docs/import-template.xlsx` (and the CSV headers) with ~3 example rows taken from `seed_demo`.
  - Tests: happy path (counts, prices, recipe lines, balances, audit events), every error kind, dry-run writes nothing, a second run refuses duplicates, and money/quantity decimals are exact.

### Docs
- [ ] **6** `README.md`: dev setup refreshed (current commands, E2E command, checks) and a link to OPERATIONS.
- [ ] **7** `docs/OPERATIONS.md`: server requirements, first deploy (DNS → `.env` → `first-run.sh`), update (`backup-now` → `git pull` → `up -d --build`, migrations run on start), rollback, logs and finding errors (Q6), user creation/deactivation/password reset (in the app, and `create_admin` if every Admin is locked out), receipt reprint, importing the catalog, `NUM_PROXIES`, renewing secrets.
- [ ] **8** `docs/USER_GUIDE.md` (plus `USER_GUIDE.ar.md` if Q8 says so): Barista guide (log in, open shift, sell, mixed pay, reprint, refund, drawer expense, close shift, shortcuts) and Admin guide (products & recipes, ingredients & purchases, stock counts, users, settings, reports, money review, audit log). Short steps, no screenshots unless you want them.

### Leftovers and checks
- [ ] **9** react-router v7 upgrade if Q11 = yes. `npm audit` then has 0 high/critical findings, or the remaining ones are listed.
- [ ] **10** CI: the new `ops` job (prod image builds, `check --deploy`, restore test). The existing backend/frontend/e2e jobs stay green.
- [ ] **11** Full check suite (§4.4) plus a local prod-stack smoke test: `https://localhost` loads, login works, a sale works, a reload on a deep link (e.g. `/orders`) works, `/api/v1/docs/` is 404, cookies are `Secure`, the response headers are present, and the backup file appears.
- [ ] **12** Sprint 6 report, PROGRESS update (also fixes the stale Sprint 4 "in progress" line), spec §14 hosting row, then the `v1.0.0` tag after approval (Q9).

## Owner tasks (human, not automated — spec §11)
- AT-21: print a receipt on the café's real printer and paper.
- Enter the real catalog and opening stock (with `import_catalog` or the screens), then check it.
- AT-24: hands-on UAT with café staff.
- Hosting and domain (Q2).
- Go/No-Go (spec §13.2).

## Exit criteria
The prod stack runs from one command with HTTPS. Backups run and a restore is proven (AT-23, automated and manual). The import is tested with a dry run. The docs are written. CI is green, including the new `ops` job. No critical or high bugs are open.

## Owner manual test checklist (draft — goes into the report)
- [ ] On your machine: `cp .env.prod.example .env`, fill it in, run `ops/first-run.sh`, then open `https://localhost` (accept the local certificate) and log in as the new Admin.
- [ ] Import `docs/import-template.xlsx` with `--dry-run`, then for real. The products, recipes and stock show on the screens.
- [ ] Make a sale and close the shift. Run `ops/backup-now.sh`, then `ops/restore.sh <file>` into a fresh DB. The order is there.
- [ ] Read OPERATIONS and the USER_GUIDE. Anything unclear goes back to me.
