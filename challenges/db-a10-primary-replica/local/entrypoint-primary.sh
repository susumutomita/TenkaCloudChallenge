#!/bin/sh
# db-a10-primary-replica — primary container entrypoint.
#
# Boots Postgres configured for physical streaming replication (wal_level,
# a replication slot, a `replicator` role — see local/db/schema.sql for the
# role/slot and the comments below for the config that has to be set before
# Postgres's very first start), then starts the Node info + /verify servers.
# The Node app coming up (and therefore this service's healthcheck passing)
# is deliberately the LAST thing that happens — local/docker-compose.yml's
# `replica` service depends on this service being *healthy*, not just
# running, so replica's pg_basebackup never races the replication slot/role
# this file creates.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DB_NAME="drill"
export PGUSER=postgres

log() { echo "[entrypoint-primary] $*"; }

# 1. Initialise the cluster on first boot, and — only on first boot, since
#    wal_level is a postmaster-context setting Postgres refuses to change via
#    reload — configure replication before Postgres ever starts.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initialising postgres cluster (primary)"
  initdb --username=postgres --pwfile=/dev/stdin --auth=trust >/dev/null <<EOF
postgres
EOF

  log "configuring replication (wal_level, listen_addresses, pg_hba) before first start"
  cat >>"$PGDATA/postgresql.conf" <<CONF

# --- db-a10-primary-replica: replication ---
listen_addresses = '*'
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
hot_standby = on
CONF
  # Trust, scoped by role/purpose, for the docker-compose network the replica
  # container reaches this one over (initdb --auth=trust only wrote loopback
  # entries, which the replica — a *different* container — cannot use).
  # Same trust-auth posture every prior Database Track drill already uses
  # (loopback-only publish, no external network, no secret to protect beyond
  # the drill's own structure); this just extends it from "this one
  # container's loopback" to "this compose project's private network".
  cat >>"$PGDATA/pg_hba.conf" <<HBA
host    replication     replicator      all                     trust
host    all             all             all                     trust
HBA
fi

# 2. Start Postgres in the background, wait for readiness.
log "starting postgres"
pg_ctl -D "$PGDATA" -o "-p 5432" -w start

createdb "$DB_NAME" 2>/dev/null || log "database $DB_NAME already exists"

# 3. Apply the schema (idempotent: guarded role/table/slot creation) — this
#    is what local/entrypoint-replica.sh's pg_basebackup depends on existing.
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Hand off to the Node servers (PID 1 replacement so signals propagate).
#    Coming up here is what flips this service's healthcheck to healthy —
#    see the file banner for why that ordering matters.
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
export REPLICA_DATABASE_URL="postgres://postgres@replica:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
