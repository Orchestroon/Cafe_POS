# Progress
Current sprint: 2 — End-to-end sale — status: committed on branch `sprint-2-end-to-end-sale` (not merged); awaiting the owner's manual browser test (report: `docs/sprints/sprint-2-report.md`)

## Done
- Sprint 0 (approved, `c1d9c10`): audit, restructure (`legacy/`, `backend/`, `frontend/`), Django bootstrap, Postgres compose, Vite + React + TS, CI workflow.
- Sprint 1 (finalized 2026-11-08, approved incl. deviation 9, CI passing on `main` per owner): core (tenant base, append-only, policy, idempotency, audit, time utils), tenancy + settings, auth + users (LAST_ADMIN, session invalidation, DatabaseCache throttling), catalog, inventory ledger, `seed_demo`, frontend shell (legacy theme, logical CSS, i18n/RTL) and all Sprint 1 admin screens. 188 backend tests pass (incl. post-audit fixes: `NUM_PROXIES`, LAST_ADMIN lock order, locked audited updates, DB errors → 400); frontend typecheck/lint/build pass. Report: `docs/sprints/sprint-1-report.md`.

## In progress
- Sprint 2 built, audited, fixed and committed on `sprint-2-end-to-end-sale` (incl. the second-audit follow-ups). 388 backend tests pass; frontend typecheck/lint/build pass. Waiting for the owner's manual browser test, then approval and merge. UI not browser-tested by the assistant.

## Next
- After Sprint 2 approval: merge `sprint-2-end-to-end-sale` into `main`. Sprint 2 — End-to-end sale (recipes, modifiers, shifts open/current, pricing + consumption engines, quote, checkout, orders, receipt, POS screen). Order unchanged (owner, 2026-11-08). Audit-log screen stays in Sprint 4.

## Owner decisions (Sprint 2 kickoff, 2026-11-10)
- Printer (D13) confirmed: browser print; paper widths 58/76/80/112 mm + A4 chosen per device; no auto-detection.
- Tax (D11): off until the Admin enables it and types the rate; when on, added on top.
- Shifts (D7) confirmed. Returns (D8/D9): answer still needed before Sprint 3.
- No git commits until the owner has tested locally (deviation from spec 0.1 "commit after each task"); includes the docker-compose change.

## Owner decisions (Sprint 2 audit, 2026-11-10)
- Fix every audit finding (H1–H2, M1–M4, L1–L5).
- A 0.00 order is sold with no payment (spec 8.4 updated).
- A Barista may open any order by its id (detail/receipt); the list stays today + exact invoice lookup (spec 6 updated).

## Handoff notes for Sprint 2
- **First:** confirm and update `docs/PROJECT_SPEC.md` with the owner's final business decisions (printer, taxes, shifts, returns) before writing Sprint 2 code.
- **UI polish (owner's manual review):** consider a Save button at the bottom of the Settings page so admins need not scroll back up.
- Set `NUM_PROXIES` in production (login throttling by client IP).

## Open questions for owner
- Q4 returns (D8/D9): needed before Sprint 3. Answers to Q1–Q3 and Q5 are in `docs/sprints/sprint-2-plan.md`.

## Deviations from spec (cumulative)
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
