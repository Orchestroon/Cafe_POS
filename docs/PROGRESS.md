# Progress
Current sprint: 0 — Audit and bootstrap — status: awaiting owner test

## Done
- Sprint 0: audit (`docs/sprints/sprint-0-audit.md`), restructure (`legacy/`, `backend/`, `frontend/`), Django bootstrap (split settings, custom User, core envelope/exception handler/money/health), Postgres compose, Vite+React+TS with `/api` proxy, react-query + react-i18next installed, CI workflow.

## In progress
- Nothing. Waiting for owner approval of Sprint 0.

## Next
- Sprint 1 — Foundation and master data (plan to be written in `docs/sprints/sprint-1-plan.md` after approval).

## Open questions for owner
- See "Questions" in `docs/sprints/sprint-0-report.md`.

## Deviations from spec (cumulative)
- Sprint 0: `tenancy.Organization` model created now (not Sprint 1) because the custom `User` FK must exist in the first migration.
- Sprint 0: Backend runs only in Docker (host has Python 3.10; spec needs 3.12+).
