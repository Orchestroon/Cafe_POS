# Sourced by the other ops scripts: run from the repo root, use the production compose file.
cd "$(dirname "$0")/.." || exit 1
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
# OPS_ENV_FILE: use another env file (the restore test runs its own isolated stack).
# Where backups are kept (the same BACKUP_DIR the compose file uses).
BACKUP_DIR=$(grep -E '^BACKUP_DIR=' "${OPS_ENV_FILE:-.env}" 2>/dev/null | head -1 | cut -d= -f2-)
BACKUP_DIR=${BACKUP_DIR:-./backups}
dc() { if [ -n "${OPS_ENV_FILE:-}" ]; then docker compose --env-file "$OPS_ENV_FILE" "$@"; else docker compose "$@"; fi; }
die() { echo "ERROR: $*" >&2; exit 1; }
