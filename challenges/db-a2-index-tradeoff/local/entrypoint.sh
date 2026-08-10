#!/bin/sh
# db-a2-index-tradeoff — container entrypoint.
#
# Boots Postgres, applies the schema (idempotent), seeds shop.orders exactly
# once (400,000 rows — re-running the seed on every restart would multiply
# it), then starts the Node info + /verify servers. The Node app captures the
# "before any index" baseline once on its very first boot; see server.mjs.
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
#    an idempotent ALTER TABLE OWNER TO).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Seed shop.orders exactly once — 400,000 rows, and nothing here makes a
#    second run of seed.sql idempotent (order_number carries no uniqueness
#    constraint on purpose), so a plain container restart must not re-run it.
ALREADY_SEEDED=$(psql -tA -d "$DB_NAME" -c "select exists(select 1 from shop.orders limit 1)")
if [ "$ALREADY_SEEDED" != "t" ]; then
  log "seeding shop.orders (400,000 rows — a few seconds)"
  psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null
else
  log "shop.orders already seeded — skipping"
fi

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
