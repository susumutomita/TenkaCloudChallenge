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
#
# NOBODY gets a shell in this container. The participant plays from the
# separate `workstation` service (local/Dockerfile's `participant` stage), so
# every access to this server now arrives over TCP from the compose network,
# and pg_hba below is written wholesale rather than appended to, so there is
# exactly one place that says who may connect:
#
#   * `postgres` (superuser) is trusted only over this container's own local
#     socket, and needs a password derived from the per-run FLAG_SEED from
#     anywhere else. The previous `host all all all trust` let anything on the
#     compose network — including the participant's own terminal — open a
#     superuser session and rewrite `audit.incident_log` /
#     `audit.metrics_samples` / `audit.diagnosis_log`, the history every
#     checkpoint in grader/grade.mjs treats as unforgeable ground truth.
#     AGENTS.md §13: privileged values are derived from the injected per-run
#     secret and never committed.
#   * the three ordinary LOGIN roles the lab runs on stay password-less. Their
#     GRANTs in db/schema.sql are the real boundary, and the lab has to stay
#     playable: `participant` keeps pg_read_all_stats, pg_signal_backend,
#     SELECT/UPDATE on ops.retention_config, and DETACH/DROP/DELETE on the
#     commerce leaves through orders_owner — but SELECT only on audit.*.
#   * anything else is refused outright instead of falling through to a trust
#     rule (in particular `replicator` outside a physical replication
#     connection, which cannot run SQL at all).
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DB_NAME="incident"
export PGUSER=postgres

log() { echo "[entrypoint-primary] $*"; }

# Derived, never committed. FLAG_SEED is injected per run by the platform
# (metadata.json's runtime.secretEnv) and is deliberately NOT passed to the
# workstation service, so the participant's container cannot recompute it.
SUPERUSER_PASSWORD="$(printf '%s' "db-battle-slow-apparently:${FLAG_SEED:-local-dev-seed}" | sha256sum | cut -d' ' -f1)"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initialising postgres cluster (primary)"
  initdb --username=postgres --pwfile=/dev/stdin --auth-local=trust --auth-host=scram-sha-256 >/dev/null <<EOF
${SUPERUSER_PASSWORD}
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

  # Written wholesale (not appended): first match wins in pg_hba.conf, so an
  # appended rule can only ever be shadowed by initdb's defaults. The replica
  # inherits this exact file through pg_basebackup, so the same boundary
  # applies to the standby's published port.
  cat >"$PGDATA/pg_hba.conf" <<'HBA'
# db-battle-slow-apparently — see this file's generator (local/entrypoint-primary.sh)
# for the rationale. First match wins; order is load-bearing.
# TYPE  DATABASE        USER               ADDRESS         METHOD

# Inside this container only: the entrypoint's own setup and the Node
# info/verify/diagnosis surface. No participant has a shell here.
local   all             all                                trust

# The standby's pg_basebackup and walreceiver. The `replication` database
# keyword matches ONLY physical replication connections, which cannot run
# SQL, so this grants no ability to read or write any table.
host    replication     replicator         all             trust

# The superuser over TCP (the sampler's connection to the replica, and its
# own loopback connection): password only, derived per run from FLAG_SEED.
host    all             postgres           all             scram-sha-256

# The ordinary LOGIN roles the lab runs on. Their GRANTs in db/schema.sql are
# the boundary; none of them can write audit.* except retention_service's own
# append-only incident_log rows.
host    all             participant        all             trust
host    all             app_service        all             trust
host    all             retention_service  all             trust

# Everything else — including a `replicator` SQL session and any role added
# later — is refused rather than silently inheriting a trust rule.
host    all             all                all             reject
HBA
fi

log "starting postgres"
pg_ctl -D "$PGDATA" -o "-p 5432" -w start

createdb "$DB_NAME" 2>/dev/null || log "database $DB_NAME already exists"

log "applying schema"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null

log "seeding data (140,000 aged rows + 3,000 current rows)"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null

# The superuser password never leaves this container: it is not in the image,
# not in db/schema.sql, and not in any statement pg_stat_activity could show
# a participant (initdb read it from stdin, not from a query).
export DATABASE_URL="postgres://postgres:${SUPERUSER_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
export REPLICA_DATABASE_URL="postgres://postgres:${SUPERUSER_PASSWORD}@replica:5432/${DB_NAME}"
log "starting node app (info :8080, verify+diagnosis :8081)"
exec node /app/app/server.mjs
