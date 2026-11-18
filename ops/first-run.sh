#!/bin/sh
# First start on a new server (safe to run again): checks .env, starts the stack, creates the
# café and its first Admin. Usage: ops/first-run.sh   (asks for the Admin username and password)
. "$(dirname "$0")/common.sh"

[ -f .env ] || die ".env not found. Run: cp .env.prod.example .env  and fill it in."
for v in DOMAIN SECRET_KEY POSTGRES_PASSWORD; do
  val=$(grep -E "^$v=" .env | head -1 | cut -d= -f2-)
  [ -n "$val" ] || die "$v is empty in .env"
done
grep -qE '^SECRET_KEY=.{50,}' .env || die "SECRET_KEY in .env must be at least 50 characters."

mkdir -p "$BACKUP_DIR"
echo "Starting the stack (the first build takes a few minutes)..."
dc up -d --build --wait || die "the stack did not become healthy: docker compose -f docker-compose.prod.yml logs"
dc exec -T backend python manage.py seed_org
# Interactive: asks for the username, then the password twice. Does nothing if an Admin exists.
dc exec backend python manage.py create_admin
echo
echo "Done. Open https://$(grep -E '^DOMAIN=' .env | cut -d= -f2-) and log in."
