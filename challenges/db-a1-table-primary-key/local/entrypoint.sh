#!/bin/sh
# db-a1-table-primary-key — container entrypoint.
#
# Boots Postgres, applies the schema (idempotent via IF NOT EXISTS), seeds
# training.members_unkeyed exactly once, then starts the Node info + /verify
# servers. Everything binds to 127.0.0.1 only via docker-compose; nothing
# leaves the box.
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

# 3. Apply the schema (safe to re-run: IF NOT EXISTS / a guarded role create).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Seed training.members_unkeyed exactly once. It has no constraint that would
#    make a second run of seed.sql idempotent on its own (that absence is the
#    whole point of the table), so a plain container restart — as opposed to
#    `docker compose down -v` — must not re-insert the same duplicates again.
ALREADY_SEEDED=$(psql -tA -d "$DB_NAME" -c "select exists(select 1 from training.members_unkeyed limit 1)")
if [ "$ALREADY_SEEDED" != "t" ]; then
  log "seeding training.members_unkeyed"
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null
else
  log "training.members_unkeyed already seeded — skipping"
fi

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
