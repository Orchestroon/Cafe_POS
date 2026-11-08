# Progress
Current sprint: 1 — Foundation and master data — status: awaiting owner test

## Done
- Sprint 0 (approved, `c1d9c10`): audit, restructure (`legacy/`, `backend/`, `frontend/`), Django bootstrap, Postgres compose, Vite + React + TS, CI workflow.
- Sprint 1 (built, awaiting owner test): core (tenant base, append-only, policy, idempotency, audit, time utils), tenancy + settings, auth + users (LAST_ADMIN, session invalidation, DatabaseCache throttling), catalog, inventory ledger, `seed_demo`, frontend shell (legacy theme, logical CSS, i18n/RTL) and all Sprint 1 admin screens. 178 backend tests pass; frontend typecheck/lint/build pass. Report: `docs/sprints/sprint-1-report.md`.

## In progress
- Nothing. Waiting for owner approval of Sprint 1.

## Next
- Sprint 2 — End-to-end sale (recipes, modifiers, shifts open/current, pricing + consumption engines, quote, checkout, orders, receipt, POS screen).

## Open questions for owner
- See "Questions" in `docs/sprints/sprint-1-report.md`.

## Deviations from spec (cumulative)
- S0: `tenancy.Organization` model created in Sprint 0 (needed by the custom User FK in the first migration).
- S0: Backend runs only in Docker (host Python 3.10 < 3.12); DB host port 5433, backend port via `BACKEND_PORT`.
- S1: `ModifierGroup` + `ProductModifierGroup` models only (no API/UI) so product↔group links exist; `PUT /products/{id}/modifier-groups` takes a JSON array.
- S1: New error code `CANNOT_DEACTIVATE_SELF` (422).
- S1: Ingredient `base_unit` create-only; unknown/read-only keys rejected on all writes; opening-balance qty > 0; zero-delta count records no movement.
- S1: Barista `/settings` omits only `invoice_prefix`.
- S1: Login throttling cache = Django `DatabaseCache` (owner decision, 2026-11-08); Django pinned to 5.2 LTS (owner decision).
