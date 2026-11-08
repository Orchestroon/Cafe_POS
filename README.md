# Drip Café POS

Django + DRF backend (`backend/`), React + TypeScript + Vite frontend (`frontend/`).
Spec: `docs/PROJECT_SPEC.md`. Status: `docs/PROGRESS.md`. `legacy/` is the old static prototype (read-only UI reference).

## Dev quick start
```bash
docker compose up -d --wait db                         # Postgres 16 (host port 5433, override with DB_PORT)
docker compose --profile backend up -d --wait backend  # Django on 127.0.0.1:8000 (override with BACKEND_PORT)
cd frontend && npm install && npm run dev              # http://localhost:5173, /api proxied to Django
```
If you changed `BACKEND_PORT`, start Vite with `VITE_API_TARGET=http://localhost:<port>`.

## Checks
```bash
docker compose run --rm backend sh -c "ruff check . && ruff format --check . && python manage.py makemigrations --check --dry-run && pytest"
cd frontend && npm run typecheck && npm run lint && npm run build
```
