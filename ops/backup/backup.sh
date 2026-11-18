#!/bin/sh
# Daily PostgreSQL backup. `backup.sh` loops forever (the compose `backup` service);
# `backup.sh once` makes one backup now. Dumps are custom-format (-Fc), written to a temp file,
# checked, then renamed, so a half-written or broken dump never replaces a good one. Old dumps are
# deleted only after a new one succeeded.
set -u
DIR=/backups
KEEP=${BACKUP_KEEP_DAYS:-14}
AT=${BACKUP_TIME:-03:00}

log() { printf '{"time":"%s","service":"backup","level":"%s","msg":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2"; }

backup_once() {
  stamp=$(date +%Y%m%d-%H%M%S)
  tmp="$DIR/.drip-$stamp.tmp"
  out="$DIR/drip-$stamp.dump"
  umask 077
  if pg_dump -h db -U drip -d drip -Fc -f "$tmp" && [ -s "$tmp" ] && pg_restore --list "$tmp" >/dev/null; then
    mv "$tmp" "$out"
    log info "backup ok: $(basename "$out") $(wc -c <"$out") bytes"
    # retention: only now that a good new dump exists
    find "$DIR" -maxdepth 1 -name 'drip-*.dump' -mtime +"$KEEP" -print -delete |
      while read -r f; do log info "deleted old backup $(basename "$f")"; done
    return 0
  fi
  rm -f "$tmp"
  log error "backup FAILED: older backups were kept"
  return 1
}

if [ "${1:-}" = "once" ]; then backup_once; exit $?; fi

log info "backup service started: daily at $AT ($TZ), keeping $KEEP days"
while true; do
  now=$(date +%s)
  next=$(date -d "today $AT" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow $AT" +%s)
  sleep $((next - now))
  backup_once || true
done
