# Progress
Current sprint: 1 — Foundation and master data — status: approved (2026-11-08); next: Sprint 2

## Done
- Sprint 0 (approved, `c1d9c10`): audit, restructure (`legacy/`, `backend/`, `frontend/`), Django bootstrap, Postgres compose, Vite + React + TS, CI workflow.
- Sprint 1 (approved 2026-11-08): core (tenant base, append-only, policy, idempotency, audit, time utils), tenancy + settings, auth + users (LAST_ADMIN, session invalidation, DatabaseCache throttling), catalog, inventory ledger, `seed_demo`, frontend shell (legacy theme, logical CSS, i18n/RTL) and all Sprint 1 admin screens. 188 backend tests pass (incl. post-audit fixes: `NUM_PROXIES`, LAST_ADMIN lock order, locked audited updates, DB errors → 400); frontend typecheck/lint/build pass. Report: `docs/sprints/sprint-1-report.md`.

## In progress
- Nothing. Sprint 2 not started (waiting for the go-ahead).

## Next
- Sprint 2 — End-to-end sale (recipes, modifiers, shifts open/current, pricing + consumption engines, quote, checkout, orders, receipt, POS screen). Order unchanged (owner, 2026-11-08). Audit-log screen stays in Sprint 4.

## Open questions for owner
- None. Sprint 1 decisions are in "Owner decisions" in `docs/sprints/sprint-1-report.md`.

## Deviations from spec (cumulative)
- S0: `tenancy.Organization` model created in Sprint 0 (needed by the custom User FK in the first migration).
- S0: Backend runs only in Docker (host Python 3.10 < 3.12); DB host port 5433, backend port via `BACKEND_PORT`.
- S1: `ModifierGroup` + `ProductModifierGroup` models only (no API/UI) so product↔group links exist; `PUT /products/{id}/modifier-groups` takes a JSON array.
- S1: New error code `CANNOT_DEACTIVATE_SELF` (422).
- S1: Ingredient `base_unit` create-only; unknown/read-only keys rejected on all writes; opening-balance qty > 0; zero-delta count records no movement.
- S1: Barista `/settings` omits only `invoice_prefix`.
- S1: Login throttling cache = Django `DatabaseCache` (owner decision, 2026-11-08); Django pinned to 5.2 LTS (owner decision).
- S1 (audit fix): Login throttle client IP = `REMOTE_ADDR` unless `NUM_PROXIES` is set (env, default 0).
- S1 (audit fix): An admin's own password reset keeps their current session; other sessions end.
