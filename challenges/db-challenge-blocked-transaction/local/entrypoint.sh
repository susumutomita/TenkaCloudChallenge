#!/bin/sh
# db-challenge-blocked-transaction — container entrypoint.
#
# Boots Postgres, applies the schema (idempotent), seeds app.accounts exactly
# once (2 fixed rows — the participant's own progress lives in that same row
# afterward, so a container restart must not reset it), then starts the Node
# info + /verify servers, which is also where the incident itself (leaked
# blocker + decoy + retrying waiter) gets orchestrated — see server.mjs.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DB_NAME="drill"
export PGUSER=postgres

log() { echo "[entrypoint] $*"; }

# 1. Initialise the cluster on first boot.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initialising postgres cluster"
  initdb --username=postgres --pwfile=/dev/stdin --auth=trust >/dev/null <<EOF
postgres
EOF
fi

# 2. Start Postgres in the background, wait for readiness.
log "starting postgres"
pg_ctl -D "$PGDATA" -o "-c listen_addresses='127.0.0.1' -p 5432" -w start

createdb "$DB_NAME" 2>/dev/null || log "database $DB_NAME already exists"

# 3. Apply the schema (safe to re-run: IF NOT EXISTS / guarded role creates /
#    idempotent grants).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Seed app.accounts exactly once. seed.sql itself is idempotent (ON
#    CONFLICT DO NOTHING), but re-running it after the incident has been
#    resolved must NOT silently mask the participant's progress with a no-op
#    re-seed on every restart — same one-time-seed contract as A1-A12.
ALREADY_SEEDED=$(psql -tA -d "$DB_NAME" -c "select exists(select 1 from app.accounts limit 1)")
if [ "$ALREADY_SEEDED" != "t" ]; then
  log "seeding app.accounts (2 rows)"
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null
else
  log "app.accounts already seeded — skipping"
fi

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
#    server.mjs decides, on its own boot, whether the incident still needs to
#    be (re-)started — see its file comment for why that's driven by the
#    CURRENT balance rather than a separate "have we started" flag.
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
export APP_SERVICE_DATABASE_URL="postgres://app_service@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
