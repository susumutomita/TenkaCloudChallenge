#!/bin/sh
# db-a11-replication-lag — replica (hot standby) container entrypoint.
#
# Same standby-bootstrap shape as db-a10-primary-replica's entrypoint-replica.sh
# (pg_basebackup -R against the primary) — this drill's subject is what
# happens to replication LAG once the standby is up, not the bootstrap itself.
#
# On first boot, waits for the primary to accept replication connections,
# then runs `pg_basebackup -R` against it: `-R` writes standby.signal AND a
# primary_conninfo (+ primary_slot_name) into postgresql.auto.conf for us —
# the replica needs no manual recovery configuration beyond that flag. Every
# later boot (e.g. a plain container restart) skips straight to starting
# Postgres, which resumes as a standby on its own because standby.signal is
# already there from the first boot.
#
# No Node app here (only local/entrypoint-primary.sh's container is the
# terminal target / info+verify surface) — this container's only job is
# being a real, second, streaming PostgreSQL server.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
PRIMARY_HOST="${PRIMARY_HOST:-primary}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPL_SLOT="${REPL_SLOT:-db_a11_replica}"
export PGUSER=postgres

log() { echo "[entrypoint-replica] $*"; }

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  # compose's `depends_on: condition: service_healthy` (local/docker-compose.yml)
  # already keeps this container from starting before the primary's Node
  # healthcheck is green, which itself only happens after the primary has
  # created the `replicator` role and the replication slot (see
  # local/entrypoint-primary.sh) — so this loop is defense in depth, not the
  # primary sequencing mechanism.
  log "waiting for primary (${PRIMARY_HOST}:${PRIMARY_PORT}) to accept replication connections"
  attempt=0
  until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U replicator >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      log "primary never became ready after ${attempt} attempts — giving up"
      exit 1
    fi
    sleep 1
  done

  # pg_basebackup needs $PGDATA at exactly 0700 (or 0750) — confirmed on a real
  # Postgres 16 instance: a freshly `mkdir`'d directory that only happens to be
  # owned by the right user, but carries a looser mode (e.g. 0755 from a
  # default umask), makes the standby refuse to start after the backup
  # completes ("data directory ... has invalid permissions"). `initdb` handles
  # this itself on the primary; nothing does it for us here, so we do it
  # explicitly rather than depend on whatever mode happened to precede us.
  mkdir -p "$PGDATA"
  chmod 700 "$PGDATA"

  log "bootstrapping standby via pg_basebackup (slot: ${REPL_SLOT})"
  # --checkpoint=fast: confirmed on a real Postgres 16 instance that WITHOUT
  # this, pg_basebackup blocks on "waiting for checkpoint to complete" until
  # the primary's next naturally scheduled checkpoint — which can be minutes
  # away on a freshly booted primary — instead of the few seconds this drill's
  # healthcheck/depends_on budget actually has.
  pg_basebackup \
    -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U replicator \
    -D "$PGDATA" \
    -S "$REPL_SLOT" \
    -X stream \
    --checkpoint=fast \
    -R \
    -v
  log "base backup complete — standby.signal + primary_conninfo written by pg_basebackup -R"
fi

log "starting postgres (standby)"
exec postgres -D "$PGDATA" -p 5432
