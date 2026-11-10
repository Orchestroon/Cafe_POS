# Drip Café POS

Django + DRF backend (`backend/`), React + TypeScript + Vite frontend (`frontend/`).
Spec: `docs/PROJECT_SPEC.md`. Status: `docs/PROGRESS.md`. `legacy/` is the old static prototype (read-only UI reference).

## Dev quick start
```bash
docker compose up -d --build --wait        # db + backend (auto-migrates) + frontend
docker compose exec backend python manage.py seed_demo   # first run only; dev only
# App: http://localhost:5173 (FRONTEND_PORT), API: 127.0.0.1:8000 (BACKEND_PORT), Postgres: 127.0.0.1:5433 (DB_PORT)
# demo logins: admin / barista1 / barista2, password Demo-pass-123
docker compose logs -f frontend            # first start runs `npm ci`, so give it a minute
docker compose down                        # stop (add -v to also wipe the database)
```
The frontend container proxies `/api` to the backend container, so nothing else needs configuring.

## Checks
```bash
docker compose run --rm backend sh -c "ruff check . && ruff format --check . && python manage.py makemigrations --check --dry-run && pytest"
cd frontend && npm run typecheck && npm run lint && npm run build
```
