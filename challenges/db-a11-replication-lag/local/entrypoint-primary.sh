#!/bin/sh
# db-a11-replication-lag — primary container entrypoint.
#
# Boots Postgres configured for physical streaming replication — the same
# baseline db-a10-primary-replica's entrypoint-primary.sh sets up (wal_level,
# a replication slot, a `replicator` role — see local/db/schema.sql), plus
# this drill's own addition: schema.sql also grants `participant` the exact
# GUC privilege needed to throttle the replica's apply rate themselves
# (`ALTER SYSTEM ON PARAMETER recovery_min_apply_delay` + `EXECUTE` on
# `pg_reload_conf()`), and creates `audit.lag_samples`, which the Node app
# populates on a timer (see local/app/pg-client.mjs's startLagSampler).
#
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

# --- db-a11-replication-lag: replication ---
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

# 3. Apply the schema (idempotent: guarded role/table/slot creation, plus the
#    parameter grants and audit.lag_samples — GRANT and CREATE TABLE IF NOT
#    EXISTS are naturally idempotent, no extra guarding needed) — this is
#    what local/entrypoint-replica.sh's pg_basebackup depends on existing.
#
#    IMPORTANT: the parameter grant (`GRANT ALTER SYSTEM ON PARAMETER ...`)
#    MUST run here, on the primary — confirmed on a real Postgres 16 primary +
#    standby pair while authoring this drill: a physical standby rejects ALL
#    regular DML/DDL, including GRANT, with
#    "cannot execute GRANT in a read-only transaction". Roles and parameter
#    ACLs (pg_parameter_acl) are shared, cluster-wide catalogs, though, so a
#    grant made here on the primary replicates to the standby automatically —
#    confirmed on the same real instance pair (a `participant` connection to
#    the REPLICA could `ALTER SYSTEM SET recovery_min_apply_delay` immediately
#    after this schema ran on the primary, no separate grant needed there).
log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

# 4. Hand off to the Node servers (PID 1 replacement so signals propagate).
#    Coming up here is what flips this service's healthcheck to healthy —
#    see the file banner for why that ordering matters. The Node app also
#    starts the background replication-lag sampler once it's up (see
#    local/app/server.mjs) — it runs for the container's whole lifetime, not
#    just while /verify happens to be called, because the lag spike this
#    drill is about is transient and would otherwise be missed between checks.
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/${DB_NAME}"
export REPLICA_DATABASE_URL="postgres://postgres@replica:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
