# Sprint 6 report — Promotions and production readiness

Branch `sprint-6` (from `main` at `6ebaf1a`). Date: 2026-11-18. **Nothing is committed**: waiting for the owner's review.
Owner decisions D1-D10 (2026-11-18) are recorded as **D23** in the spec. Left untouched on purpose: `backend/config/settings/dev.py`, `frontend/vite.config.ts` (Cloudflare tunnel hosts) and `.brud/`.

## What was built

### Part 1 — Promotions (spec 7.9, 8.1, 8.4, 8.12, 8.13, 9)
- **Rules** (new app `apps/promotions`): `Promotion` + `ComboSlot`. Percentage / fixed discount for **specific sizes, a category, or the whole order**; **fixed-price combos** (BOGO = a combo of the same size); optional dates (inclusive), days of the week, a **Happy Hour window** (may pass midnight; an overnight window belongs to the day it started), an active switch, and `auto_apply` (automatic, or tapped by the cashier). Schedules use the café timezone. DB check constraints back the serializer validation. Used promotions cannot be deleted (PROTECT, no DELETE endpoint), only switched off.
- **Engine** (`sales/promotions.py`, pure, whole cents) — **no stacking, best deal wins**: one promotion per cart unit; item/category discounts and combos work on the size's **base price** (extras charged in full); combos claim units highest price first and apply only when they beat the item discounts those units had; an **order-wide** promotion is an *alternative* (the larger total wins, a tie keeps the line-level result) and takes the whole subtotal. Discounts are split to the cent (largest remainder), so lines add up exactly and no line goes below 0. `line_discount` is authoritative; `unit_discount` is display only.
- **Quote / checkout**: same engine, fresh data inside the checkout transaction. The client sends only `promotion_ids` (taps), never a discount; a changed total (e.g. Happy Hour ended) gives the existing 409 `PRICE_CHANGED`. Idempotent retries replay the stored result. Saved: `OrderItem.promotion_snapshot` (list) and one `OrderPromotion` row per promotion (name snapshot, so later edits change nothing). Audit `order.created` lists the promotions.
- **Accounting and inventory**: the consumption and costing path is untouched. A test sells the same cart with and without a combo + an order promotion and asserts identical stock movements, quantities, unit costs, `consumption_snapshot` and `cost_total`. Reports: `profit` gets `sales_before_discounts` / `promotion_discounts` (correct for tax-inclusive prices too; `sales`, cost and gross profit are after discounts), `sales-summary` already had gross / discounts / collected, new **`promotions` report** (orders, tapped count, discount given per promotion). No per-promotion profit (D8).
- **Admin UI**: **Promotions** tab under Menu & Recipes (`/admin/promotions`, sidebar entry stays active). List with plain-language "what / when / applied / status" (Active, Scheduled, Ended, Off, "on right now"), on/off toggle, slide-over form (type, scope, value, size picker with search, category list, combo parts, dates, weekday chips, Happy Hour window, live preview). **Below-cost warning** (D8): `GET /promotions/variant-costs` (recipe cost at the average cost) + a pure, unit-tested check; shows sizes whose discounted price is under cost, and for combos "even the cheapest" / "the most expensive" bundle; advice only, never blocks saving; sizes without a known cost are counted, never treated as 0. Full EN/AR (1066 keys in sync, Arabic plural forms), logical CSS only, phone layout checked.
- **POS and receipt**: cart shows the crossed-out price, the saving per line, one row per promotion in the totals, and **chips** for tap-to-apply offers (the quote says what each would add; a tapped offer that does not win says so). Success screen, receipt, order detail and print show the same breakdown. Audit log has readable promotion events (names, never ids).

### Part 2 — Production readiness
- **`docker-compose.prod.yml`**: `db` (no published port), `backend` (prod image **without dev extras**, non-root, read-only filesystem, migrate on start, gunicorn, healthcheck with the real Host header), `web` (Caddy: automatic HTTPS, built React app, `/api` same-origin, SPA deep-link fallback, long cache for hashed assets, `no-cache` for the page, one HSTS header, strict CSP, nosniff, frame deny, referrer and permissions policies), `backup`. Log rotation on all. TLS configurable: `CADDY_SITE_ADDRESS`, `CADDY_AUTO_HTTPS=off`, `CADDY_TRUSTED_PROXIES` for a Cloudflare Tunnel. `.env.prod.example` documents every value; `.gitignore` covers `.env*` and `backups/`.
- **`prod.py` hardening**: HSTS (starts at 1 day, env switch), nosniff, `X-Frame-Options DENY` (the middleware was **missing** from `base.py`, now added), referrer and COOP policies, healthcheck path exempt from the SSL redirect, **refuses to start** with a short/example `SECRET_KEY`, `ALLOWED_HOSTS` empty or `*`, or non-https CSRF origins. `manage.py check --deploy` has **no warnings** (a test runs it; W021 "preload" and, unless `HSTS_INCLUDE_SUBDOMAINS=true`, W005 are silenced on purpose and documented in `prod.py`). Tests also prove `/schema` and `/docs` are 404 and `/health` exposes only `status`/`db`.
- **`create_admin`**: password only at a hidden prompt (twice) or `--password-stdin`, never an argument; checked by the app's validators; username unique ignoring case; does nothing (exit 0, says so) when the café already has an active Admin unless `--force`; audit event without the password. `ops/first-run.sh` is safe to repeat.
- **Backups**: daily `pg_dump -Fc` at `BACKUP_TIME` (café time), temp file → verified → renamed, mode 600, retention `BACKUP_KEEP_DAYS` (14) applied **only after** a good new dump, JSON log line per run. `ops/backup-now.sh`, `ops/restore.sh` (default into a **new** database; `--replace` takes a safety dump first, asks for YES, restarts the app). **AT-23 automated**: `ops/test-restore.sh` runs an isolated copy of the stack, makes a sale through the API, backs up, restores into a new DB and over the live one, compares orders / total / audit / stock movements / users, and also checks HTTPS, headers, deep link, docs 404, http→https redirect, Secure cookie. New CI job `ops`. Docs: `docs/OPERATIONS.md`, `docs/BACKUP_RESTORE.md`.
- **Fonts self-hosted** (`@fontsource` Cairo, Instrument Sans, JetBrains Mono; no Google request, verified by a browser run: zero outside requests). **react-router v7** (declarative mode, imports moved to `react-router`; `useTransitions={false}` keeps v6 timing, see below). **`legacy/` removed**; `CLAUDE.md`, README, spec tree and a CSS comment updated. `PROGRESS.md` rewritten (the stale Sprint 5 lines are gone).

## Problems found and fixed during verification
1. **Strict CSP broke print paper size**: the receipt page injects an inline `<style>` with `@page { size: 80mm … }`; the browser blocked it in the production stack. Now allowed **by hash** (five fixed texts); `receiptPage.ts` + a test keep the hashes in sync with the Caddyfile.
2. **react-router v7 + `startTransition`** made two existing e2e tests race (a click right after a navigation). `useTransitions={false}` restores v6 behavior; both pass.
3. `check --deploy` needed `XFrameOptionsMiddleware`; the healthcheck needed the SSL-redirect exemption and the Host header; gunicorn 27 needs a writable `$HOME` on a read-only image (`HOME=/tmp`).
4. The POS fired an `EMPTY_CART` quote in the 300 ms before the debounced key caught up (pre-existing, harmless 422 in the console); fixed.
5. Arabic: the minus sign of discount amounts landed on the wrong side (`EGP 13.00−`); amounts are now bidi-isolated.

## Checks (all run in Docker, 2026-11-18)
| Check | Result |
|---|---|
| Backend `pytest` | **851 passed** (was 737; +114: engine incl. a 300-cart random invariant test, schedule, API, checkout, reports, prod settings, `create_admin`, permissions matrix and barista-leak sweep extended, query budgets) |
| `ruff check`, `ruff format --check`, `makemigrations --check`, `spectacular --validate --fail-on-warn` | clean |
| Frontend `typecheck`, `lint`, `i18n:check`, `build` | clean |
| Frontend unit tests | 62 pass in the dev container; +6 (`receiptPage`) need the whole repo and pass when it is mounted / in CI (verified) |
| Playwright e2e (isolated stack) | **66 passed** (59 earlier specs + new `21-promotions`: Admin builds an offer and gets the below-cost warning, Barista sells with it and the receipt/records match, tap-to-apply chip and "best deal wins", phone and Arabic). **Re-run in full after the last UI fixes: 66 passed** |
| `ops/test-restore.sh` (AT-23 + prod smoke) | **passed** (isolated prod stack, HTTPS, headers, sale, backup, restore into new DB and `--replace`) |
| Browser smoke on the prod stack (Playwright, HTTPS) | login, deep-link cold load, create offer, sale with promotion, receipt, reload on a receipt URL, Arabic, phone: **no outside requests, no CSP violations** (after fix 1) |
| `npm audit --omit=dev` | **0 vulnerabilities** (react-router advisories gone) |

Chrome (the Claude-in-Chrome extension) froze on screenshots again, so the layout was checked through Playwright screenshots, which were read and deleted.

## Things to know (deviations and limits)
- **Spec changed** (owner-approved, D23): promotions are in v1; `starts_on/ends_on` dates + weekdays + a time window replace the old `starts_at/ends_at` datetimes (they cannot say "weekdays 3-5 pm"); `line_discount` is no longer always `unit_discount × qty`; `OrderItem.promotion_snapshot` is a list (it was always null, no migration of data).
- **Combo matching is greedy**, highest price first, not an optimal assignment. With overlapping category parts a human might pick a better pairing; the result is deterministic and never negative.
- The below-cost warning cannot judge a **fixed amount off a whole order** (it depends on the cart) and ignores extras.
- Not built (D8): usage caps, coupon codes, minimum order, per-promotion profit.
- **Dev DB**: migrated (two new tables, additive) after a backup `db-backups/drip-before-sprint6-20261118.dump`. No data was changed. The dev frontend container got the new packages through `npm install` (the e2e stack needs its container recreated to pick up new packages: `docker compose -f docker-compose.e2e.yml down` first).
- `npm audit` still lists 15 findings in **dev tooling** (vite / vitest / eslint chains); none is shipped, and `npm audit fix --force` would downgrade vite and vitest, so it was not used.
- `npm ci` in the e2e/CI runner fails now and then on a network reset (seen 3 times here); a retry fixes it.
- Not verified: a real certificate from Let's Encrypt (needs your domain and DNS), a real Cloudflare Tunnel run, printing on a real printer (AT-21), and the off-site copy of backups (yours to set up).

## Owner manual test (checklist)
- [ ] Admin → Menu & Recipes → **Promotions** → New: "Happy Hour", 20 % on one size, with hours 15:00-17:00 and weekdays. Check the preview text, then try 99 % and see the below-cost warning.
- [ ] Make a **combo** (a drink category + a pastry) with a fixed price; see it on the list.
- [ ] Barista POS: add the items. The cart shows the old price crossed out, the saving and the total. Sell it, open the receipt (and print). Check Orders → the order → promotions.
- [ ] Make a **tap-to-apply** offer (uncheck "Apply automatically"): the chip appears in the cart; tapping it changes the total only when it is the better deal.
- [ ] Switch an offer off while a sale is in the cart, then pay: you get "The price changed".
- [ ] Reports → **Promotions** and **Profit** ("Sales before discounts", "Promotion discounts"). Audit log shows the offer being created and edited, in words.
- [ ] Switch to Arabic: the Promotions page, form, POS cart and receipt read right-to-left; a phone-width window works.
- [ ] Production: on a machine with Docker, `cp .env.prod.example .env`, fill it, `ops/first-run.sh`, open `https://localhost`, log in, `ops/backup-now.sh`, then `ops/restore.sh <file>`. Or just run `ops/test-restore.sh`.
- [ ] Read `docs/OPERATIONS.md` and `docs/BACKUP_RESTORE.md`; anything unclear goes back to me.
