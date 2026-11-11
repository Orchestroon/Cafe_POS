# Sprint 4 plan — Stabilization

Read: CLAUDE.md, PROGRESS.md, sprint-3-report (known limits, deviations L1/L4), spec §4.4, §5.5, §5.6, §5.8, §6, §7.9, §9.3 (`/audit-events`), §10.1–10.6, §11 (Sprint 4), §12 (AT-19, AT-20), §13.

Status: **implemented and approved by the owner (2026-11-11).** Approved by the owner ("approved, start", 2026-11-11). S3 is still being checked by the owner and is not part of this sprint. Report: `docs/sprints/sprint-4-report.md`.

Branch: `sprint-4-stabilization` from `main` (`ba0674b`).

## Owner answers (2026-11-10)
| # | Answer |
|---|---|
| Q1 | Yes: Playwright in Docker on a separate e2e stack, plus an `e2e` CI job. |
| Q2 | Yes: Vitest for the pure frontend logic. |
| Q3 | Yes to the lint rule and `i18n:check`. **Arabic is translated in this sprint:** I fill every `ar.json` value from `en.json`; the owner then reviews the Arabic. (Changes D12.) |
| Q4 | Promotions skipped in Sprint 4. |
| Q5 | **No commits until the owner approves** (Sprint 2 rule). |
| Q6 | Pending: the owner wants the API-vs-spec differences first, then decides. |
| Q7 | The owner re-tests Sprints 1–3 first and reports bugs; **Sprint 4 starts after that.** |
| Q8 | Push `main` after Sprint 4. |

## Questions for the owner (as first asked)
| # | Topic | Proposal (default if you agree) |
|---|---|---|
| Q1 | Where Playwright runs | In Docker: a separate e2e stack (`docker-compose.e2e.yml`, own DB volume and ports, so your dev data is never touched) plus the official Playwright image. One command: `docker compose -f docker-compose.e2e.yml run --rm e2e`. Also a new **`e2e` CI job** that runs the same thing on every push. |
| Q2 | Frontend unit tests | Add **Vitest** for the pure frontend logic that has had no tests since Sprint 2 (`pos/checkoutRules.ts`, `lib/decimal.ts`, `pos/cart.ts`). Small, no UI. |
| Q3 | Hardcoded-string check | Add the ESLint plugin `eslint-plugin-i18next` (rule `no-literal-string`, JSX text only) to `npm run lint`, plus a small script `npm run i18n:check` (every key used in code exists in `en.json`; `en.json` and `ar.json` have the same keys). Arabic **values stay empty** (D12) — who will write the Arabic text, and when? |
| Q4 | P1 promotions | **Skip in Sprint 4.** The spec allows them only if everything else is green and you agree; I suggest leaving them for after v1. |
| Q5 | Commits | Sprint 3 rule again: commits on the sprint branch as tasks finish (Conventional Commits, no attribution lines), no push and no merge until you approve. Or: no commits until you have tested locally (Sprint 2 rule). Which one? |
| Q6 | Audit deviations L1/L4 from Sprint 3 | **Keep the code, update the spec** (refund response `status`, nested `totals` on shift close; `purchases-expenses` ignores cashier/shift; `top-products` max 100 rows). Changing the API now would also mean changing the screens. |
| Q7 | Bugs you found in Sprints 1–3 | None are recorded. Anything you noticed while testing goes into task 9. |
| Q8 | Push `main` | Still not pushed. Push now, or at the end of Sprint 4? |

## Assumptions (go to the report's Deviations if they hold)
1. `GET /audit-events` is Admin-only, read-only, paginated like the other lists, newest first. `from`/`to` are café-local dates with the same parser as the reports (2000–2100, 400 otherwise). Bad UUIDs give 400. Other cafés' events never appear.
2. The audit viewer shows the stored summary JSON as-is (expandable). It does not translate summaries into sentences.
3. AT-20 "timeout after the server commits" is simulated in Playwright by letting the request reach the server and then dropping the response before the browser gets it. That is exactly the case the Sprint 2 audit fixed (H2/M6).
4. Responsive and print QA: Playwright checks what a machine can check (no sideways scroll, key elements visible, receipt width per paper size, invoice number visible) and saves screenshots/PDFs for you. **The look is still your call** — the report lists the files to open.
5. Performance target "under ~2 s" is checked with timings on the seeded dev data and with query-count limits in pytest (so a future N+1 fails a test).
6. No new business rules in this sprint. If a fix changes behavior written in the spec, the spec changes in the same commit (spec 0.1 #9).

## Backend
- [x] **1 Audit events API** (`audit`)
  - `GET /audit-events`, Admin (`audit.view` in `core/policy.py`). Filters: `action`, `actor_id`, `entity_type`, `entity_id`, `from`, `to`. Each row: `id`, `created_at`, `action`, `entity_type`, `entity_id`, `actor` (`id`, `username`, or `null`), `summary`.
  - Add the route to the permission matrix (Barista 403, anonymous 401) and the cross-tenant test.
  - Index check: `(organization, created_at)` exists; add `(organization, action, created_at)` only if the query plan needs it.
  - Tests: every filter, combined filters, ordering, pagination, bad params → 400, Cairo day boundaries, no secrets in any recorded summary (scan all events made by the test suite flows).
- [x] **2 Permission sweep**
  - The matrix already fails when a route is missing. Extend it: for every route a Barista may call (`BOTH`), the Barista response is scanned for admin-only fields (ingredient `cost`/`unit_cost`/`avg_cost`, recipes, modifier effects, `invoice_prefix`, supplier and purchase data, other users' data). One list of forbidden keys, one recursive check, so a new leak fails the test.
  - Barista write attempts on admin routes: 403 **and** row counts / audit events unchanged (AT-19), for every admin write route.
  - Re-read `core/policy.py` against spec §6 line by line; any mismatch is fixed or asked.
- [x] **3 Performance**
  - `django_assert_max_num_queries` limits for quote, checkout (1 and 5 items with modifiers), order list, order detail, receipt, shift current, product list for the POS, each report.
  - Fix any N+1 with `select_related` / `prefetch_related`; add indexes only where a query needs them (migration reviewed, no destructive change).
  - Time quote and checkout on the seeded dev stack (20 runs, report the median and worst) and write the numbers in the report.

## Frontend
- [x] **4 Audit log viewer** `/admin/audit`
  - Filter bar (action, user, entity type, entity id, date range with the existing `Range` component), table, a row expands to show the summary JSON, pagination. Link from the sidebar for Admins only. Logical CSS, `en.json` + empty `ar.json` keys.
  - From an order, shift, purchase or product page: a small "History" link that opens the viewer filtered by that entity.
- [x] **5 Playwright E2E** (`frontend/e2e/`)
  - Setup: e2e stack, fresh DB, `seed_demo`, log in once per role and reuse the session.
  - Flows (spec §11): login (good and bad password); open shift → sale with modifiers → mixed payment → receipt; refund; purchase post; shift close; a Barista blocked from admin pages (UI redirect **and** API 403).
  - AT-20: (a) response dropped after commit → "Checking payment status…" → Retry → exactly **one** order (checked through the API); (b) offline → clear error, nothing created; (c) a 503 from the proxy → resent with the same key, one order.
- [x] **6 Responsive QA** — POS, Orders, Order detail, Shift, Receipt at phone 375×812, tablet 768×1024, desktop 1280×800, in English and Arabic: no sideways scroll, cart/bottom sheet reachable, Pay button visible. Screenshots saved to `frontend/e2e/artifacts/`.
- [x] **7 Print QA** — receipt printed to PDF at 58 mm, 80 mm and A4: page size matches, nothing cut off, invoice number and totals visible, REPRINT shows only on a reprint. PDFs saved for you.
- [x] **8 i18n coverage**
  - Lint rule + `i18n:check` (Q3). Fix every hardcoded string it finds.
  - RTL smoke in Playwright: switch to عربي → `<html dir="rtl" lang="ar">`, sidebar on the right, no sideways scroll on the main pages.
  - **Arabic translation (Q3):** fill every `ar.json` value (clear café/POS Arabic, same placeholders `{{…}}` and plural forms as `en.json`); `i18n:check` also fails on an empty Arabic value from now on. Update D12 in the spec. The owner reviews the Arabic; a list of terms I was unsure about goes into the report.
- [x] **9 Bugs and leftovers**
  - Owner-reported bugs (Q7) — see "Owner-reported items" below.
  - Review `npm audit` advisories (open since Sprint 1): fix what has a safe update, list the rest in the report.
  - Vitest for the pure logic (Q2).

## Owner-reported items (re-test of Sprints 1–3, 2026-11-10/11; list still open)
- [x] **B1 Open-shift popup cannot be closed** (`pages/Pos.tsx`, `OpenShift` modal has a no-op `onClose`).
  - ✕, Esc and a click outside close it; no shift is opened.
  - The POS stays visible but locked: product tiles greyed and not clickable, cart locked, Pay disabled (tiles are already disabled without a shift).
  - The shift bar shows "No open shift" + an **Open shift** button that reopens the popup.
  - Server unchanged (`SHIFT_NOT_OPEN` already refuses a sale). Playwright test: close popup → tiles not clickable → Open shift → sale works.
- [x] **B2 Keyboard shortcuts across the system** (new feature, owner request).
  - One shortcuts file (`frontend/src/lib/shortcuts.ts`) + a `?` help popup + key hints on buttons. Ignored while typing in a field (except Esc, Ctrl+Enter, F-keys). Works the same in Arabic (uses the physical key code).
  - Proposed keys: global `?` help, `Alt+P/O/S` POS/Orders/Shift, `Alt+D` Dashboard (Admin), `/` search, `Esc` close. POS `F2` Pay, `F4` Open shift, `1`–`9` category, arrows + `Enter` product, `+`/`−` qty of last line, `Del` remove last line, `Ctrl+Backspace` clear cart (confirm). Product sheet `1`–`9` size, `Enter` add. Payment `F5/F6/F7` cash/card/mixed, `Enter` confirm. Receipt `Ctrl+P`. Lists `↑/↓` + `Enter`, `N` new (Admin). Forms `Ctrl+Enter` save.
  - The owner reviews and audits the final key list; i18n keys for every hint.
- [x] **B3 Size with no recipe sells without deducting stock** (owner decision: option A).
  - New field `ProductVariant.track_stock` (default `true`, migration; existing sizes without a recipe → **owner to confirm** whether the migration sets them to `false` or leaves them blocked until a recipe is added).
  - Quote and checkout: a size with `track_stock = true` and no recipe lines → 422 `RECIPE_MISSING` (new error code, spec §9.2) with the size id; the till disables that product with a "No recipe" note.
  - Admin: "No stock tracking" checkbox per size (audited); "No recipe" badge on Products; Dashboard card "Sizes without a recipe".
  - `seed_demo` sets every demo size correctly. Tests: quote/checkout refusal, `track_stock=false` sells with no movement, permission and audit.
  - Spec: D18 note, §7.3, §8.2, §8.10, §9.2 updated in the same commit.
- B3 existing data (owner, 2026-11-11): the migration sets `track_stock = true` for every size, so sizes that have no recipe today stay **blocked** until the Admin adds a recipe or ticks "No stock tracking".
- [x] **R2 Option with no stock effect** (owner: yes, same rule as B3).
  - New field `ModifierOption.track_stock` (default `true`; migration leaves existing options `true`).
  - Quote and checkout: a chosen option with `track_stock = true` and no effect for that size (and no "All sizes" effect) → 422 `INVALID_MODIFIER` with `reason: no_effect` (today an option with no effects at all is silently allowed).
  - Admin Modifiers: "No stock effect" checkbox per option (audited) and a "No ingredient" badge. `seed_demo` updated. Tests as B3. Spec §7.4, §8.2 updated.
- [x] **C2 Last close shown when opening a shift** (owner: yes, information only).
  - `GET /shifts/current` with no open shift returns `meta.last_closed` = the user's last closed shift (`closed_at`, `actual_cash`) or `null`; the Open-shift popup shows "Last shift closed with X". No blocking, no new stored field.
- **S1** keep the hand-typed ingredient cost for v1 (owner, 2026-11-11). Spec unchanged.
- **C1 decided (owner, 2026-11-11): shifts stay per user (D7 unchanged).** Each user counts only their own cash; no code change.
- **Still open (owner checking):** S3 ("Adjust stock" link on refunded orders). Not in Sprint 4 unless the owner decides.
- [x] **Q6** (`docs/sprints/sprint-4-q6-api-vs-spec.md`) — owner: **1B, 2A, 3A, 4A**.
  - 1B: refund response also sends `order_status` (= `status`); test.
  - 2A: spec §9.4 shift close updated to the nested `totals` shape.
  - 3A: `purchases-expenses` returns 400 if `cashier_id` or `shift_id` is sent; spec §8.13 says it has no such filter; test.
  - 4A: `top-products` keeps 100 rows and returns `meta.truncated`; spec §8.13; test.
- Q7: no more owner-reported bugs for now (2026-11-11). Bugs found later are added here.

## Commit messages (owner rule, 2026-11-10)
No commits until the owner approves. Each commit then has a Conventional Commit subject and a body listing **everything done and every fix** (with B-numbers), no attribution lines.

## CI and checks
- [x] **10** Add the `e2e` job to `.github/workflows/ci.yml` (Q1); upload screenshots/PDFs/traces as CI artifacts on failure.
- [x] **11** Full check suite (§4.4): ruff, format, makemigrations check, pytest with coverage, spectacular validate, typecheck, lint, build, i18n check, Vitest, Playwright.

## Exit criteria (spec)
No critical or high bugs open; every AT that can be automated is automated (map in the report); CI green.

## Owner manual test checklist (draft — goes into the report)
- [ ] Run the E2E suite yourself once with the one command (Q1); it ends green.
- [ ] Admin → Audit log: find today's sale (`order.created`), a refund (`refund.created`, with the reason) and a shift close; filter by user and by date; expand a summary. A Barista cannot open the page.
- [ ] Open the saved screenshots (phone / tablet / desktop, EN and AR) and the receipt PDFs (58 / 80 / A4) and confirm they look right.
- [ ] On your real phone and tablet: POS sale, Orders, Shift close.
- [ ] Print a receipt on the real printer again after any print CSS change.
- [ ] Switch to عربي and read through every screen; mark any wrong or unnatural Arabic.
