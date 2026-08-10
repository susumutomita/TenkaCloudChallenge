#!/bin/sh
# db-a6-lock — container entrypoint.
#
# Boots Postgres, applies the schema (idempotent), seeds inventory.stock exactly
# once (2 fixed rows — the participant's own progress lives in those same rows
# afterward, so a container restart must not reset them), then starts the Node
# info + /verify servers.
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
#    track_commit_timestamp=on is required by local/grader/pg-client.mjs's use
#    of pg_xact_commit_timestamp() — see local/db/schema.sql's comment on why
#    the grader needs the TRUE commit time of a transaction, not a timestamp
#    captured mid-transaction by a trigger.
log "starting postgres"
pg_ctl -D "$PGDATA" \
  -o "-c listen_addresses='127.0.0.1' -p 5432 -c track_commit_timestamp=on" \
  -w start

createdb "$DB_NAME" 2>/dev/null || log "database $DB_NAME already exists"

# 3. Apply the schema (safe to re-run: IF NOT EXISTS / a guarded role create /
#    CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS + CREATE TRIGGER).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Seed inventory.stock exactly once. seed.sql itself is idempotent (ON
#    CONFLICT DO NOTHING), but re-running it after the participant has changed
#    quantities must NOT silently mask their progress with a no-op re-seed on
#    every restart — same one-time-seed contract as A1-A4.
ALREADY_SEEDED=$(psql -tA -d "$DB_NAME" -c "select exists(select 1 from inventory.stock limit 1)")
if [ "$ALREADY_SEEDED" != "t" ]; then
  log "seeding inventory.stock (2 rows: widget, gadget)"
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null
else
  log "inventory.stock already seeded — skipping"
fi

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
