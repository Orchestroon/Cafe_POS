# Progress
Current sprint: 4 — Stabilization — status: **finalized, approved by the owner (2026-11-11)** after the manual test. Report: `docs/sprints/sprint-4-report.md`. Being committed step by step (one commit per step; the owner pushes each).

## Done
- Sprint 3 (finalized and approved by the owner 2026-11-10 after the manual browser test, incl. the documented deviations; merged into `main` locally, not pushed; 571 backend tests pass): shift close/list/detail, full refunds + refund/payment ledgers, suppliers/purchases (idempotent post), expenses (drawer rules, void), six reports, dashboard and all Sprint 3 screens. Audit log endpoint and viewer deferred to Sprint 4 by the owner. Report: `docs/sprints/sprint-3-report.md`. Independent audit M1–M4, L2, L3, L5, L6 fixed; L1 and L4 stay as deviations (below).
- Sprint 0 (approved, `c1d9c10`): audit, restructure (`legacy/`, `backend/`, `frontend/`), Django bootstrap, Postgres compose, Vite + React + TS, CI workflow.
- Sprint 2 (finalized and approved by the owner 2026-11-10; merged into `main` via PR #1): recipes, modifiers, shifts open/current, pricing + consumption engines, quote, idempotent checkout, orders, receipt, POS screen, plus both audits' fixes. 388 backend tests pass; frontend typecheck/lint/build pass; owner's manual browser test passed. Report: `docs/sprints/sprint-2-report.md`.
- Sprint 1 (finalized 2026-11-08, approved incl. deviation 9, CI passing on `main` per owner): core (tenant base, append-only, policy, idempotency, audit, time utils), tenancy + settings, auth + users (LAST_ADMIN, session invalidation, DatabaseCache throttling), catalog, inventory ledger, `seed_demo`, frontend shell (legacy theme, logical CSS, i18n/RTL) and all Sprint 1 admin screens. 188 backend tests pass (incl. post-audit fixes: `NUM_PROXIES`, LAST_ADMIN lock order, locked audited updates, DB errors → 400); frontend typecheck/lint/build pass. Report: `docs/sprints/sprint-1-report.md`.

## In progress
- Sprint 4 (branch `sprint-4-stabilization`, uncommitted): owner items B1 (closable open-shift popup), B2 (keyboard shortcuts), B3 (size needs a recipe or "No stock tracking"), R2 (option needs an effect or "No stock effect"), C2 (last close on the open-shift popup), Q6 1B/2A/3A/4A, full Arabic translation; spec tasks: audit log API + viewer, permission/leak sweep, query budgets + timings, Playwright E2E (27 tests incl. AT-20), responsive/print/RTL QA, i18n lint + check, Vitest, CI e2e job. Fixed along the way: recipe PUT 500 without waste_pct, receipts wider than the printable area, a midnight-flaky test, missing error texts. Owner feedback round 1 (2026-11-11) done: readable audit log (sentences, labelled details, Before → After, no JSON; names resolved by the API; all actions/areas/labels in Arabic, enforced by a test) and the Cairo font for Arabic. 619 backend tests, 20 unit tests, 29 E2E pass. Waiting for the owner's manual test, Arabic review and approval.
- `docs/LOGIC_REVIEW.md` (temporary, owner review; delete after). S3 still open.

## Next
- After the owner approves Sprint 4: commit (descriptive messages listing every fix), merge, then push `main` (owner, 2026-11-10: push after Sprint 4).
- Open questions in the Sprint 4 report: react-router v7 upgrade (npm audit), `stock` report cashier/shift filter, phone Orders table layout, S3.
- Sprint 5 (release readiness) on the owner's go-ahead.

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
