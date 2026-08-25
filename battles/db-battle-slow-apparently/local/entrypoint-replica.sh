#!/bin/sh
# db-battle-slow-apparently — replica (hot standby) container entrypoint.
#
# Same standby-bootstrap shape as db-a10/db-a11's entrypoint-replica.sh:
# `pg_basebackup -R` against the primary on first boot, then just start
# Postgres on every later boot (standby.signal already exists from boot 1).
#
# No Node app here — only the primary's container is the terminal target /
# info+verify surface. This container's only job is being a real, second,
# streaming PostgreSQL server whose apply capacity is genuinely limited by
# docker-compose's cpu/mem limits (local/docker-compose.yml), not by any
# artificial delay knob — the lag the participant observes here is a real
# consequence of WAL volume outrunning constrained apply capacity, the same
# "failure mechanics at lab scale" ADR the parent Issue calls for.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
PRIMARY_HOST="${PRIMARY_HOST:-primary}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPL_SLOT="${REPL_SLOT:-db_battle_slow_apparently_replica}"
export PGUSER=postgres

log() { echo "[entrypoint-replica] $*"; }

if [ ! -s "$PGDATA/PG_VERSION" ]; then
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

  mkdir -p "$PGDATA"
  chmod 700 "$PGDATA"

  log "bootstrapping standby via pg_basebackup (slot: ${REPL_SLOT})"
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
