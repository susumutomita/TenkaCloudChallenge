#!/bin/sh
# db-a7-mvcc — container entrypoint.
#
# Boots Postgres, applies the schema (idempotent), seeds mvcc.tickets and
# mvcc.reference exactly once (the participant's own progress lives in those
# same rows afterward, so a container restart must not reset them), then
# starts the Node info + /verify servers.
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

# 3. Apply the schema (safe to re-run: IF NOT EXISTS / a guarded role create /
#    CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE TRIGGER).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Seed exactly once. seed.sql itself is idempotent (ON CONFLICT DO
#    NOTHING), but re-running it after the participant has changed rows must
#    NOT silently mask their progress with a no-op re-seed on every restart —
#    same one-time-seed contract as A1-A6.
ALREADY_SEEDED=$(psql -tA -d "$DB_NAME" -c "select exists(select 1 from mvcc.tickets limit 1)")
if [ "$ALREADY_SEEDED" != "t" ]; then
  log "seeding mvcc.tickets (5 rows) and mvcc.reference (1 row)"
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null
else
  log "mvcc.tickets already seeded — skipping"
fi

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
