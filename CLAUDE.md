If ponytail guidance conflicts with docs/PROJECT_SPEC.md, the spec wins. Never simplify idempotency, locking, snapshots, audit, permissions or tests.

Before any work, read docs/PROJECT_SPEC.md and docs/PROGRESS.md.
Work one sprint at a time and stop for owner approval at the end of each sprint.

## Testing
- Keep test output quiet: `pytest -q --tb=short` (already the default in `backend/pyproject.toml`).
- Backend needs Python 3.12 and Postgres, so run it in Docker from the repo root:
  `docker compose up -d --wait db` then `docker compose run --rm backend pytest` (`docker compose up -d --wait` starts the whole stack: db, backend, frontend)
  (also `ruff check .`, `ruff format --check .`, `python manage.py makemigrations --check --dry-run`).
- Frontend (from `frontend/`): `npm run typecheck && npm run lint && npm run build`.

## UI/UX rule (persistent)
- Preserve the visual theme, colors, typography and layout shell from `legacy/index.html` and `legacy/css/style.css` (Growl Tech tokens, Instrument Sans, sidebar/top-bar/bottom-nav shell).
- Convert physical left/right CSS properties to logical properties (RTL support) as the styles are ported.
- Do NOT copy legacy business logic or flows from `legacy/js/app.js` / `legacy/js/store.js`. `legacy/` is a read-only reference; never edit it.

## Git
- Never include `Co-Authored-By` trailers (or any other attribution lines) in git commit messages.
