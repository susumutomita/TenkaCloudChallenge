#!/bin/sh
# db-battle-slow-apparently — primary container entrypoint.
#
# Same streaming-replication baseline as db-a10/db-a11's primary (wal_level,
# a replication slot, a `replicator` role — see local/db/schema.sql), plus
# this Battle's own scenario schema/seed and the Node app that serves the
# info page, /verify, /diagnosis, and the continuous background sampler that
# is what every checkpoint actually grades from (see local/grader/grade.mjs).
#
# Coming up here is deliberately the LAST thing that happens: local/
# docker-compose.yml's `replica`, `api`, and `retention-worker` services all
# `depends_on: primary: condition: service_healthy`, so nothing else starts
# racing the schema/seed/replication-slot setup this file does.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DB_NAME="incident"
export PGUSER=postgres

log() { echo "[entrypoint-primary] $*"; }

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initialising postgres cluster (primary)"
  initdb --username=postgres --pwfile=/dev/stdin --auth=trust >/dev/null <<EOF
postgres
EOF

  log "configuring replication (wal_level, listen_addresses, pg_hba) before first start"
  cat >>"$PGDATA/postgresql.conf" <<CONF

# --- db-battle-slow-apparently: replication ---
listen_addresses = '*'
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
hot_standby = on
CONF
  cat >>"$PGDATA/pg_hba.conf" <<HBA
host    replication     replicator      all                     trust
host    all             all             all                     trust
HBA
fi

log "starting postgres"
pg_ctl -D "$PGDATA" -o "-p 5432" -w start

createdb "$DB_NAME" 2>/dev/null || log "database $DB_NAME already exists"

log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

log "seeding data (140,000 aged rows + 3,000 current rows)"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null

export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
export REPLICA_DATABASE_URL="postgres://postgres@replica:5432/${DB_NAME}"
log "starting node app (info :8080, verify+diagnosis :8081)"
exec node /app/app/server.mjs
