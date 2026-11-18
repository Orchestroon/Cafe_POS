# Operations guide

How to run the café's server. For backups and restores see `docs/BACKUP_RESTORE.md`.

## What runs

`docker-compose.prod.yml` starts four containers, nothing else is exposed to the internet except ports 80 and 443 of `web`:

| Container | What it does |
|---|---|
| `web` | Caddy. Gets and renews the HTTPS certificate by itself, serves the app, sends `/api` to Django. Adds the security headers. |
| `backend` | Django + gunicorn, settings `config.settings.prod`. Runs the migrations every time it starts. |
| `db` | PostgreSQL 16. No port is published; data is in the `drip_pgdata` volume. |
| `backup` | A daily `pg_dump` into `./backups` (see BACKUP_RESTORE). |

One café per server (single branch).

## What you need

- A Linux server (1 CPU, 1 GB RAM is enough for one café) with Docker and the Docker Compose plugin.
- A domain name (for example `pos.mycafe.com`) whose DNS record points to the server, and ports **80 and 443** open to the internet. Caddy needs both to get the certificate.
- `git`.

## First deploy

```bash
git clone <repository> drip && cd drip
cp .env.prod.example .env
nano .env            # DOMAIN, SECRET_KEY, POSTGRES_PASSWORD (the file explains every value)
ops/first-run.sh     # builds, starts, creates the café and asks for the first Admin
```

Open `https://<DOMAIN>` and log in. `ops/first-run.sh` is safe to run again: it never creates a second Admin by itself.

The first start takes a few minutes (it builds the app). The certificate is issued on the first visit/start; if it does not appear, check that the DNS record points to the server and that ports 80/443 are open (`docker compose -f docker-compose.prod.yml logs web`).

**Local trial (no domain):** `DOMAIN=localhost` in `.env`. Caddy then uses its own certificate and the browser warns once. Set `HTTP_PORT=8080` and `HTTPS_PORT=8443` if 80/443 are taken.

### Behind a Cloudflare Tunnel

If the tunnel already provides HTTPS, tell Caddy not to ask for a certificate. In `.env` set:

```
CADDY_SITE_ADDRESS=:80
CADDY_AUTO_HTTPS=off
CADDY_TRUSTED_PROXIES=private_ranges
```

Point the tunnel at `http://web:80` (put `cloudflared` in the same Docker network), and set `DOMAIN` to the tunnel's public host name (it feeds `ALLOWED_HOSTS` and the CSRF origin).

### The `.env` values that matter

- `SECRET_KEY` (50+ random characters) and `DOMAIN` are checked at start-up: a short or example key, `ALLOWED_HOSTS=*`, or a non-https origin make the backend refuse to start with a clear message (`docker compose -f docker-compose.prod.yml logs backend`).
- `HSTS_SECONDS` starts at 1 day. When HTTPS has worked for a while, set `31536000` (1 year) and run `docker compose -f docker-compose.prod.yml up -d`.
- `NUM_PROXIES=1` is already set in the compose file: login throttling uses the real client address that Caddy forwards.

## Update to a new version

```bash
ops/backup-now.sh                                   # always first
git pull
docker compose -f docker-compose.prod.yml up -d --build --wait
```

Migrations run when the backend starts. If the new version is wrong, go back: `git checkout <previous tag or commit>` and run the same `up -d --build --wait`. If a migration changed the data in a way the old version cannot read, restore the backup you took first (BACKUP_RESTORE).

## Logs and finding errors

Every service writes JSON lines to Docker (kept 5 files of 10 MB each).

```bash
docker compose -f docker-compose.prod.yml logs -f backend          # the app
docker compose -f docker-compose.prod.yml logs backend | grep '"level": "ERROR"'
docker compose -f docker-compose.prod.yml logs web | grep '"status":5'   # server errors seen by Caddy
docker compose -f docker-compose.prod.yml ps                        # health of each container
```

The audit log in the app (Admin → Audit log) shows who did what.

## People

- Add, deactivate and reset passwords in the app: Admin → Team & permissions.
- If every Admin is locked out, from the server: `docker compose -f docker-compose.prod.yml exec backend python manage.py create_admin --force` (asks for the username and password at a hidden prompt; the password is never typed as an argument).

## Other

- **Receipt reprint:** Orders → open the order → Reprint (browser print; paper width is set per device in the receipt screen).
- **Secrets:** to change `SECRET_KEY` (everyone is logged out) or the database password, edit `.env`. For the database password also run `docker compose -f docker-compose.prod.yml exec db psql -U drip -c "ALTER USER drip PASSWORD '<new>'"` first, then `up -d`.
- **Stop / start:** `docker compose -f docker-compose.prod.yml down` (data stays) / `up -d`. Never use `down -v` on the café's server: it deletes the database and the certificates.
- **Disk:** Docker logs and backups grow slowly; check `df -h` now and then.
- **Checks before you trust a new server:** `ops/test-restore.sh` runs the whole stack on throw-away data (own project name and ports) and proves HTTPS, the headers, a sale, a backup and a restore.
