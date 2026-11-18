#!/bin/sh
# Restore a backup. Default: into a NEW database, the live one is not touched, so you can look
# first. Usage:
#   ops/restore.sh backups/drip-20261118-030000.dump                 -> database drip_restore_<date>
#   ops/restore.sh <dump> --into mycopy                              -> a database named mycopy
#   ops/restore.sh <dump> --replace                                  -> REPLACES the live database
# --replace stops the app, saves a safety dump of the live database first, restores, then starts
# the app again (it runs the migrations on start).
[ -f "${1:-}" ] || { echo "usage: ops/restore.sh <dump file> [--into <db name> | --replace]" >&2; exit 1; }
dump=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")  # absolute, before common.sh changes directory
. "$(dirname "$0")/common.sh"
shift
mode=new; target="drip_restore_$(date +%Y%m%d%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    --into) target=${2:-}; mode=new; shift 2 ;;
    --replace) mode=replace; shift ;;
    *) die "unknown option $1" ;;
  esac
done
case "$target" in *[!a-zA-Z0-9_]*|"") die "database names use letters, digits and _ only" ;; esac
[ "$target" != "drip" ] || [ "$mode" = replace ] || die "use --replace to restore over the live database"

psql() { dc exec -T db psql -v ON_ERROR_STOP=1 -U drip -d postgres "$@"; }
restore_into() { dc exec -T db pg_restore --no-owner --no-privileges --exit-on-error -U drip -d "$1" <"$dump"; }

if [ "$mode" = new ]; then
  psql -c "CREATE DATABASE $target" || die "could not create $target (does it exist?)"
  restore_into "$target" || die "restore failed; $target was left for inspection"
  echo "Restored into database '$target'. The live database 'drip' was not touched."
  exit 0
fi

echo "This REPLACES the live database with $dump."
if [ -z "${ASSUME_YES:-}" ]; then printf "Type YES to go on: "; read -r a; [ "$a" = YES ] || die "cancelled"; fi
mkdir -p "$BACKUP_DIR"
safety="$BACKUP_DIR/before-restore-$(date +%Y%m%d%H%M%S).dump"
umask 077
dc exec -T db pg_dump -Fc -U drip -d drip >"$safety" || die "safety dump failed, nothing changed"
echo "Safety dump of the current database: $safety"
dc stop web backend
psql -c "DROP DATABASE IF EXISTS drip WITH (FORCE)" -c "CREATE DATABASE drip" || die "could not recreate drip (safety dump: $safety)"
restore_into drip || die "restore failed (safety dump: $safety)"
dc up -d --wait backend web
echo "Done. The app is running on the restored data."
