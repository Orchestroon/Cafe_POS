#!/bin/sh
# AT-23 (automated) + local production smoke test. Brings up an ISOLATED copy of the production
# stack (own project name, volumes, ports and secrets; your real stack is never touched), makes a
# sale, takes a backup, restores it into a new database and over the live one, and checks that the
# data came back. Also checks the HTTPS front door. Needs docker and curl. Takes a few minutes.
set -eu
. "$(dirname "$0")/common.sh"

work=$(mktemp -d)
export COMPOSE_PROJECT_NAME=drip-ops-test OPS_ENV_FILE="$work/env"
secret() { head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-"$1"; }
cat >"$work/env" <<EOF
DOMAIN=localhost
SECRET_KEY=$(secret 64)
POSTGRES_PASSWORD=$(secret 24)
HTTP_PORT=18080
HTTPS_PORT=18443
BACKUP_DIR=$work/backups
BACKUP_UID=$(id -u)
BACKUP_GID=$(id -g)
EOF
mkdir -p "$work/backups"
cleanup() { dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; dc logs --tail 40 backend web 2>&1 | tail -80 >&2; exit 1; }
ok() { echo "ok   $*"; }

echo "== start the production stack (isolated)"
dc up -d --build --wait || fail "the stack did not become healthy"
dc exec -T backend python manage.py seed_org >/dev/null
printf '%s\n' "$(secret 20)Aa1!" | dc exec -T backend python manage.py create_admin --username opsadmin --password-stdin
# a second run must change nothing and still succeed (first-run.sh is safe to repeat)
printf '%s\n' "x" | dc exec -T backend python manage.py create_admin --username other --password-stdin 2>&1 | grep -q "nothing was created" || fail "create_admin is not idempotent"
ok "stack healthy, café and first Admin created, create_admin is idempotent"

echo "== front door (Caddy, HTTPS, headers)"
base="https://localhost:18443"
curl -sk -o /dev/null -w '%{http_code}' "$base/api/v1/health" | grep -q 200 || fail "health"
hdr=$(curl -sk -D - -o /dev/null "$base/")
for h in "strict-transport-security" "content-security-policy" "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy"; do
  echo "$hdr" | grep -qi "$h" || fail "missing header $h"
done
[ "$(curl -sk -o /dev/null -w '%{http_code}' "$base/orders")" = 200 ] || fail "deep link /orders must load the app"
curl -sk "$base/orders" | grep -q 'id="root"' || fail "deep link did not return the app"
[ "$(curl -sk -o /dev/null -w '%{http_code}' "$base/api/v1/docs/")" = 404 ] || fail "API docs must be 404 in production"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18080/)" = 308 ] || fail "http must redirect to https"
curl -sk -c "$work/jar" "$base/api/v1/auth/csrf" -D - -o /dev/null | grep -i 'set-cookie: csrftoken' | grep -qi secure || fail "csrf cookie must be Secure"
ok "HTTPS, security headers, SPA deep link, docs 404, http->https redirect, Secure cookie"

echo "== make a sale through the API"
check=$(dc exec -T backend python manage.py shell <ops/restore-test-data.py | grep '^RESTORE-CHECK' | cut -d' ' -f2-)
[ -n "$check" ] || fail "could not create the test sale"
ok "sale made: orders, total, audit events, stock movements, users = $check"

figures() { # <database>
  dc exec -T db psql -U drip -d "$1" -Atc "select (select count(*) from sales_order) || ' ' || (select total from sales_order order by created_at desc limit 1) || ' ' || (select count(*) from audit_auditevent) || ' ' || (select count(*) from inventory_stockmovement) || ' ' || (select count(*) from accounts_user)"
}
live=$(figures drip)
[ "$live" = "$check" ] || fail "live figures '$live' differ from the sale's '$check'"

echo "== backup"
dc run --rm --no-deps -T --entrypoint /bin/sh backup /ops/backup.sh once || fail "backup failed"
dump=$(ls "$work"/backups/drip-*.dump | head -1)
[ -s "$dump" ] || fail "no dump file"
[ "$(stat -c %a "$dump")" = 600 ] || fail "backup file must be private (600)"
ok "backup written: $(basename "$dump")"

echo "== restore into a NEW database"
"$(dirname "$0")/restore.sh" "$dump" --into drip_restore_test >/dev/null || fail "restore into a new database"
[ "$(figures drip_restore_test)" = "$check" ] || fail "restored data differs: $(figures drip_restore_test) vs $check"
ok "restored database has the same orders, total, audit events, stock movements and users"

echo "== restore OVER the live database (--replace)"
dc exec -T backend python manage.py shell -c "from apps.sales.models import Order; Order.objects.all().first(); print('live ok')" >/dev/null
ASSUME_YES=1 "$(dirname "$0")/restore.sh" "$dump" --replace >/dev/null || fail "restore --replace"
[ "$(figures drip)" = "$check" ] || fail "after --replace the live data differs"
ls "$work"/backups/before-restore-*.dump >/dev/null 2>&1 || fail "no safety dump was taken"
curl -sk -o /dev/null -w '%{http_code}' "$base/api/v1/health" | grep -q 200 || fail "app not healthy after --replace"
ok "live database replaced from the backup, safety dump taken, app healthy again"

echo
echo "AT-23 passed."
