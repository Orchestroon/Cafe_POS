# Backups and restore (AT-23)

## What is backed up

The whole PostgreSQL database (orders, stock ledger, purchases, users, audit log, settings). The certificates (Docker volume `drip_caddy_data`) and the `.env` file are **not** in the dump: keep a copy of `.env` somewhere safe (it holds the secret key and the database password).

## Daily backup

The `backup` container makes a dump every day at `BACKUP_TIME` (café time, default 03:00) into `BACKUP_DIR` (default `BACKUP_DIR` (`./backups`)), named `drip-YYYYMMDD-HHMMSS.dump`.

- Each dump is written to a temporary file, checked with `pg_restore --list`, then renamed: a half-written or broken dump never replaces a good one.
- Files are private (mode 600, owned by `BACKUP_UID`).
- Dumps older than `BACKUP_KEEP_DAYS` (default 14) are deleted **only after** a new good one exists. If a backup fails, nothing is deleted and the log says `backup FAILED`:
  `docker compose -f docker-compose.prod.yml logs backup`.
- One backup now (also before every update): `ops/backup-now.sh`.

## Copy backups off the server

A backup that lives only on the same disk is lost with the server. Copy `BACKUP_DIR` (`./backups`) somewhere else every day, for example from your own computer:

```bash
rsync -av user@server:/path/to/drip/backups/ ~/drip-backups/
```

or with `rclone` to a cloud drive. (Not built in: it needs your account.)

## Restore

```bash
# 1. Into a NEW database, to look at the data. The live database is not touched.
ops/restore.sh backups/drip-20261118-030000.dump                 # creates drip_restore_<time>
ops/restore.sh backups/drip-20261118-030000.dump --into mycopy   # or choose the name
docker compose -f docker-compose.prod.yml exec db psql -U drip -d mycopy -c "select count(*) from sales_order"

# 2. Replace the live database (a real disaster). Asks you to type YES.
ops/restore.sh backups/drip-20261118-030000.dump --replace
```

`--replace` stops the app, **saves a safety dump of the current database first** (`backups/before-restore-<time>.dump`), restores, and starts the app again (it runs the migrations on start). If anything fails, the safety dump is named in the message.

Restoring on a **new server**: do the first deploy (OPERATIONS.md) with the same `.env`, copy the dump to `backups/`, then `ops/restore.sh <dump> --replace`.

## Test it (monthly)

`ops/test-restore.sh` does it all on throw-away data: starts an isolated copy of the production stack, makes a sale, backs up, restores into a new database and over the live one, and compares orders, totals, audit events, stock movements and users. It also runs in CI (job `ops`). Test your real backups monthly with step 1 above and a `select count(*)`.
