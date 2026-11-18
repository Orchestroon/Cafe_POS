# Progress
Current sprint: 5 — Logic review and fixes — status: **implemented (2026-11-17), waiting for the owner's manual test and approval.** Report: `docs/sprints/sprint-5-report.md`. Branch `sprint-5-logic`: D20 + Sprint 5 are committed in `27a39a2` ("Adding new fixes", pushed to `origin/sprint-5-logic`; verified 2026-11-18: 714 backend, 29 unit tests green). **Step 1 (D22) is implemented on top, uncommitted, waiting for the owner.** Sprint 4 was finalized and approved on 2026-11-11.

## Done
- Sprint 3 (finalized and approved by the owner 2026-11-10 after the manual browser test, incl. the documented deviations; merged into `main` locally, not pushed; 571 backend tests pass): shift close/list/detail, full refunds + refund/payment ledgers, suppliers/purchases (idempotent post), expenses (drawer rules, void), six reports, dashboard and all Sprint 3 screens. Audit log endpoint and viewer deferred to Sprint 4 by the owner. Report: `docs/sprints/sprint-3-report.md`. Independent audit M1–M4, L2, L3, L5, L6 fixed; L1 and L4 stay as deviations (below).
- Sprint 0 (approved, `c1d9c10`): audit, restructure (`legacy/`, `backend/`, `frontend/`), Django bootstrap, Postgres compose, Vite + React + TS, CI workflow.
- Sprint 2 (finalized and approved by the owner 2026-11-10; merged into `main` via PR #1): recipes, modifiers, shifts open/current, pricing + consumption engines, quote, idempotent checkout, orders, receipt, POS screen, plus both audits' fixes. 388 backend tests pass; frontend typecheck/lint/build pass; owner's manual browser test passed. Report: `docs/sprints/sprint-2-report.md`.
- Sprint 1 (finalized 2026-11-08, approved incl. deviation 9, CI passing on `main` per owner): core (tenant base, append-only, policy, idempotency, audit, time utils), tenancy + settings, auth + users (LAST_ADMIN, session invalidation, DatabaseCache throttling), catalog, inventory ledger, `seed_demo`, frontend shell (legacy theme, logical CSS, i18n/RTL) and all Sprint 1 admin screens. 188 backend tests pass (incl. post-audit fixes: `NUM_PROXIES`, LAST_ADMIN lock order, locked audited updates, DB errors → 400); frontend typecheck/lint/build pass. Report: `docs/sprints/sprint-1-report.md`.

## In progress
- **Step 1 — costing, idempotency, auto codes (D22)** (2026-11-18, committed, not pushed; 735 backend tests, frontend checks green; **Playwright e2e NOT run**: two attempts failed on network errors (npm ci timeout, ECONNRESET), not on tests. Run `docker compose -f docker-compose.e2e.yml run --rm e2e` before pushing): expense creation is idempotent (scope `expense`, `ExpenseDialog` keeps its key on a network error); a purchase post refuses with 409 `PURCHASE_CHANGED` if the draft's source / credit / supplier changed before the lock; blank SKUs get `SKU-00001` (model `save()`, shared locked counter `core.Sequence`); a posted purchase gets `PUR-00001` (`receipt_no`, at post, gapless); migrations backfill old sizes and posted/voided purchases (core 0003, catalog 0004, purchasing 0004); the opening-balance service itself refuses a line without quantity and value. The opening value is also a DB check (`opening_balance_has_value`, inventory 0006). The dev DB was backed up (`db-backups/drip-before-step1-reseed-20261118.sql`), its new migrations were verified on the real data, then it was reset and re-seeded (admin / barista1 / barista2, `Demo-pass-123`), so the old value-less opening rows are gone.
- **Missing costs (D20)** (uncommitted, now part of Sprint 5; its "Recalculate cost" part removed by D21): the Profit report showed a 100 % margin because an order without a cost was counted as 0. Now cost / profit / margin show "can't calculate" and name the ingredients without a price; a migration fills the average cost from purchases posted before D19 (dev DB: Coffee Beans 1.60/g, Water 10.00/pc); Admin **Recalculate cost** fills in past orders from today's average cost (marked estimate, audited). 673 backend tests, 23 unit, 45 E2E pass. Waiting for the owner's review of all the logic.
- **Money review (D19)**: committed and merged into `main` (da57375, a84107b), 2026-11-17; push pending on the owner's side. Next step (owner): review the supplier / inventory / ingredient cycle.
- Products & recipes screen + new shell: committed `8acd04c` on `feature/products-screen` (owner go-ahead 2026-11-16). Owner decision: the new shell replaces the legacy sidebar layout — this overrides the CLAUDE.md "preserve the legacy shell" rule for the shell (theme tokens kept); roll back if it does not suit.
- Sprint 4 (finalized and approved 2026-11-11, merged via PR #2): owner items B1 (closable open-shift popup), B2 (keyboard shortcuts), B3 (size needs a recipe or "No stock tracking"), R2 (option needs an effect or "No stock effect"), C2 (last close on the open-shift popup), Q6 1B/2A/3A/4A, full Arabic translation; spec tasks: audit log API + viewer, permission/leak sweep, query budgets + timings, Playwright E2E (27 tests incl. AT-20), responsive/print/RTL QA, i18n lint + check, Vitest, CI e2e job. Fixed along the way: recipe PUT 500 without waste_pct, receipts wider than the printable area, a midnight-flaky test, missing error texts. Owner feedback round 1 (2026-11-11) done: readable audit log (sentences, labelled details, Before → After, no JSON; names resolved by the API; all actions/areas/labels in Arabic, enforced by a test) and the Cairo font for Arabic. 619 backend tests, 20 unit tests, 29 E2E pass. Done.
- `docs/LOGIC_REVIEW.md` deleted (owner, 2026-11-17); S3 became P7 in the Sprint 5 plan.

## Next
- Open from the Sprint 4 report: react-router v7 upgrade (npm audit) → Sprint 6. (Stock report filter, phone Orders and S3 done in Sprint 5.)
- **Sprint 5 — Logic review and fixes** (owner, 2026-11-17): implemented (D21: cost only from purchases / opening balances with value, adjustments only out, no profit from stock coming in, purchase = quantity + total paid, supplier credit with partial payments, card fee %, return to stock, profit report like "100 → 10", option costs, stock report by cashier/shift, phone order cards, Recalculate removed). 714 backend, 29 unit, 48 E2E tests pass. Dev DB backed up (`db-backups/drip-before-sprint5-20261117-2353.sql`) and re-seeded. Waiting for the owner's manual test; then commit (D20 separate), then push.
- **Sprint 6 — Release readiness** (moved from Sprint 5): draft plan `docs/sprints/sprint-6-plan.md`, re-checked after Sprint 5.

## Owner decisions (Sprint 4 planning, 2026-11-10/11)
- Feedback round 1 (2026-11-11): audit log for non-technical users, raw data removed; Arabic font = Cairo.
- Playwright in Docker on a separate e2e stack + CI job; Vitest for pure logic; i18n lint rule + check script.
- **Arabic is translated in Sprint 4** (D12 changed); the owner reviews it.
- P1 promotions skipped in Sprint 4. No commits until the owner approves; commit messages list everything done and every fix. Push `main` after Sprint 4.
- Re-test of Sprints 1–3 → B1 (closable open-shift popup), B2 (shortcuts everywhere), B3 option A (no recipe → cannot sell unless "No stock tracking"; existing sizes stay blocked), R2 (same for options), C2 (show last close, information only).
- S1: ingredient cost stays hand-typed for v1. **C1: shifts stay per user (D7 unchanged).** S3: owner still checking.
- Q6: 1B, 2A, 3A, 4A (`docs/sprints/sprint-4-q6-api-vs-spec.md`).

## Owner decisions (Sprint 3 kickoff, 2026-11-10)
- D8 (any Admin or Barista may fully refund any paid order, reason mandatory, audited, no approval) and D9 (refund back to the original methods and amounts) are Final. No partial refunds in v1.
- §8.6.8: no automatic restocking on refund; the Admin adjusts stock manually.
- D10 (Barista drawer expenses, forced onto their open shift) and D17 (card terminal reference optional) are Final.
- §8.7: posting a `cash_drawer` purchase needs the poster's own open shift, an Admin included.
- A drawer expense of a closed shift cannot be voided (`EXPENSE_NOT_VOIDABLE`).
- Audit log endpoint and viewer stay in Sprint 4. D12: new i18n keys go in both `en.json` and `ar.json` (empty values in `ar.json`).
- Commits are allowed again for Sprint 3 (Conventional Commits, no attribution trailers); the branch is not pushed or merged until the owner says so.

## Owner approval (Sprint 3, 2026-11-10)
- Manual browser test completed; Sprint 3 approved with the deviations listed in the Sprint 3 report and below (S3 entries).

## Owner decisions (Sprint 2 kickoff, 2026-11-10)
- Printer (D13) confirmed: browser print; paper widths 58/76/80/112 mm + A4 chosen per device; no auto-detection.
- Tax (D11): off until the Admin enables it and types the rate; when on, added on top.
- Shifts (D7) confirmed. Returns (D8/D9): answer still needed before Sprint 3.
- No git commits until the owner has tested locally (deviation from spec 0.1 "commit after each task"); includes the docker-compose change.

## Owner approval (Sprint 2, 2026-11-10)
- Confirmed the recorded decisions (D11 tax on top, D12, D13, D7, 0.00 order rule, Barista order detail by id).
- Manual browser test passed; Sprint 2 approved and finalized.

## Owner decisions (Sprint 2 audit, 2026-11-10)
- Fix every audit finding (H1–H2, M1–M4, L1–L5).
- A 0.00 order is sold with no payment (spec 8.4 updated).
- A Barista may open any order by its id (detail/receipt); the list stays today + exact invoice lookup (spec 6 updated).

## Handoff notes for Sprint 2 (done)
- **First:** confirm and update `docs/PROJECT_SPEC.md` with the owner's final business decisions (printer, taxes, shifts, returns) before writing Sprint 2 code.
- Settings already has a Save button at the bottom (checked in Sprint 3).
- Set `NUM_PROXIES` in production (login throttling by client IP).

## Open questions for owner
- None open for Sprint 3. (Q4 returns was answered 2026-11-10 — see the Sprint 3 kickoff decisions.)

## Deviations from spec (cumulative)
- S4: shortcut keys differ from the proposed table (Alt+H not Alt+D; F8 cycles payment method instead of F5/F6/F7; `0` = all categories). i18n lint checks JSX text only. `/audit-events` adds `meta.actions`/`meta.entity_types`. Receipt widths = paper minus margins. Details: `docs/sprints/sprint-4-report.md`.
- S0: `tenancy.Organization` model created in Sprint 0 (needed by the custom User FK in the first migration).
- S0: Backend runs only in Docker (host Python 3.10 < 3.12); DB host port 5433, backend port via `BACKEND_PORT`.
- S1: `ModifierGroup` + `ProductModifierGroup` models only (no API/UI) so product↔group links exist; `PUT /products/{id}/modifier-groups` takes a JSON array.
- S1: New error code `CANNOT_DEACTIVATE_SELF` (422).
- S1: Ingredient `base_unit` create-only; unknown/read-only keys rejected on all writes; opening-balance qty > 0; zero-delta count records no movement.
- S1: Barista `/settings` omits only `invoice_prefix`.
- S1: Login throttling cache = Django `DatabaseCache` (owner decision, 2026-11-08); Django pinned to 5.2 LTS (owner decision).
- S1 (audit fix): Login throttle client IP = `REMOTE_ADDR` unless `NUM_PROXIES` is set (env, default 0).
- S2: New error code `REGISTER_NOT_CONFIGURED` (422) when opening a shift and the café does not have exactly one default register (v1 is single-branch; users carry no branch yet).
- S1 (audit fix): An admin's own password reset keeps their current session; other sessions end. Approved by the owner (2026-11-08).
- S3: no migration for the `purchase` stock-movement choices (already existed). Barista asking for another user's shift gets 404. `POST /purchases/{id}/post` returns 200. Report dates follow the order/refund `created_at` (spec 8.13 note). Closed-shift drawer expenses cannot be voided. Details in `docs/sprints/sprint-3-report.md`.
- S3 (audit): refund response uses `status` (spec `order_status`) and the shift close response nests figures under `totals` (spec flat) — L1; `purchases-expenses` ignores `cashier_id`/`shift_id` and `top-products` is capped at 100 rows — L4. **Resolved in Sprint 4 (Q6: 1B, 2A, 3A, 4A); spec updated.** Purchase post now returns `stock_movement_ids` and `expense_id`; an Admin drawer expense cannot take `paid_at`.
