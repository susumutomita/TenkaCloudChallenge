#!/bin/sh
# db-a12-partition — container entrypoint.
#
# Boots Postgres, applies the schema (idempotent), seeds metrics.events
# exactly once (120,000 rows across 6 monthly partitions — re-running the
# seed on every restart would multiply it, and nothing in seed.sql makes a
# second run a no-op, same as db-a2-index-tradeoff's shop.orders), then
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

# 3. Apply the schema (safe to re-run: IF NOT EXISTS on every CREATE TABLE /
#    a guarded role create / idempotent ALTER TABLE OWNER TO / REVOKE).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Seed metrics.events exactly once — 120,000 rows, and nothing here makes
#    a second run of seed.sql idempotent (created_at carries no uniqueness
#    constraint on purpose), so a plain container restart must not re-run it —
#    a participant's mid-drill DELETE/DETACH/DROP progress lives in this same
#    table and must never be silently reset. Checked against the January leaf
#    partition specifically (not the partitioned parent): once the drill is
#    solved, February is gone and January is empty, so a check against the
#    parent could plausibly still see rows from March-June and not tell "seed
#    already ran" apart from "seed never ran" — the leaf never lies about it.
ALREADY_SEEDED=$(psql -tA -d "$DB_NAME" -c "select exists(select 1 from metrics.events_y2024m03 limit 1)")
if [ "$ALREADY_SEEDED" != "t" ]; then
  log "seeding metrics.events (120,000 rows across 6 monthly partitions)"
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null
else
  log "metrics.events already seeded — skipping"
fi

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
