# Sprint 0 report

## What was built
- Repo restructure: old app moved to `legacy/` (git renames, untouched); new `backend/` and `frontend/`.
- **Backend** (Django 5.2, DRF, Python 3.12 in Docker, Postgres 16):
  - split settings `base/dev/test/prod`, env config via `django-environ`, JSON logging, session auth defaults, secure-cookie flags in prod;
  - custom `accounts.User` (UUID pk, `organization`, `role`, `display_name`, `preferred_language`) in the first migration;
  - `tenancy.Organization` (pulled forward, see Deviations);
  - `core`: success envelope renderer, error envelope + exception handler (401 instead of DRF's 403 for anonymous, `ApiError` for domain codes), `money.py` (`q_money/q_qty/q_cost`, ROUND_HALF_UP, floats rejected), `GET /api/v1/health`, JSON 404, OpenAPI at `/api/v1/schema/` and `/docs/` in non-prod.
- **Frontend**: Vite + React 18 + TS (`allowJs`), `react-router-dom`, `@tanstack/react-query`, `react-i18next` (`en.json`, `ar.json` skeleton), minimal API client, placeholder page showing health. `/api` proxied to Django. The legacy UI is **not** ported yet.
- **Infra**: `docker-compose.yml` (Postgres; Django under `--profile backend`), `.env.example`, `.gitignore`, `.github/workflows/ci.yml`.
- **Docs**: `CLAUDE.md` (original rule kept, added testing + UI/UX rules), `docs/PROGRESS.md`, audit.

## Test / check results (local)
| Check | Result |
|---|---|
| `ruff check .` | pass |
| `ruff format --check .` | pass |
| `makemigrations --check --dry-run` | no changes |
| `pytest` | 9 passed (coverage ~90%) |
| `tsc --noEmit`, `eslint src`, `vite build` | pass |
| `GET /api/v1/health` through Vite proxy (`:5173`) | `{"data":{"status":"ok","db":"ok"},"meta":{}}` |
| `docker compose up` | DB healthy |
| CI workflow | written, **not run** (never pushed) |

## Deviations
1. `tenancy.Organization` created in Sprint 0 because `User.organization` needs it in the first migration. Everything else in tenancy stays in Sprint 1.
2. Backend only runs in Docker (host Python 3.10 < spec 3.12).
3. DB host port is 5433 (5432 busy on this machine); backend port is `BACKEND_PORT` (8000 busy here, I used 8010 for verification).
4. Django admin / `messages` not installed (not in spec); `createsuperuser` therefore needs an organization: use the Sprint 1 `seed_demo`/`seed_org` commands.

## Known issues
- CI unverified until pushed.
- Login throttling cache note (audit risk 6).
- `npm audit` reports advisories in dev tooling; not reviewed.

## Owner checklist
- [ ] `docker compose up -d --wait db` → db healthy.
- [ ] `docker compose --profile backend up -d --wait backend` then `curl localhost:8000/api/v1/health` → `{"data":{"status":"ok","db":"ok"},...}` (use `BACKEND_PORT` if 8000 is busy).
- [ ] `cd frontend && npm install && npm run dev`, open http://localhost:5173 → "API and database are up".
- [ ] `docker compose run --rm backend pytest` → all pass, quiet output.
- [ ] Review `docs/sprints/sprint-0-audit.md` and the new layout.
- [ ] Push the branch and confirm CI is green.

## Questions
1. Approve the layout and Sprint 0 as is?
2. Login throttling: OK to add a DB- or Redis-backed cache in Sprint 1, or run gunicorn with one worker?
3. OK to pin Django to the 5.2 LTS line?
