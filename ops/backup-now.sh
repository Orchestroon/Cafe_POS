#!/bin/sh
# One backup right now (also run it before every update). Files land in BACKUP_DIR (./backups).
. "$(dirname "$0")/common.sh"
dc run --rm --no-deps -T --entrypoint /bin/sh backup /ops/backup.sh once
