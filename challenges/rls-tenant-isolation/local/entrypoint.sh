#!/bin/sh
# rls-tenant-isolation — container entrypoint.
#
# Boots Postgres, applies the schema + seed, then loads the participant's RLS
# policies (solution/policies.sql when non-empty, otherwise the vulnerable
# broken-policies.sql), and finally starts the Node API + /verify servers.
#
# Everything binds to 127.0.0.1 only via docker-compose; nothing leaves the box.
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
DB_NAME="rls_demo"
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

# 3. Apply schema + seed (idempotent via IF NOT EXISTS / ON CONFLICT).
log "applying schema + seed"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/schema.sql >/dev/null
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f /app/db/seed.sql >/dev/null

# 4. Load policies: the participant's answer if they wrote one, else the broken
#    starting state. "Non-empty" means it contains at least one SQL statement
#    (a line that is not blank and not a `--` comment).
SOLUTION="/app/solution/policies.sql"
if [ -s "$SOLUTION" ] && grep -qvE '^[[:space:]]*(--.*)?$' "$SOLUTION"; then
  log "loading participant solution policies"
  POLICIES="$SOLUTION"
else
  log "no solution yet — loading vulnerable broken-policies.sql"
  POLICIES="/app/db/broken-policies.sql"
fi
# Reset to a clean policy state first so re-runs are deterministic.
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" >/dev/null <<'SQL'
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'documents'
  loop
    execute format('drop policy if exists %I on public.documents', p.policyname);
  end loop;
end $$;
SQL
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$POLICIES" >/dev/null

# 5. Hand off to the Node servers (PID 1 replacement so signals propagate).
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/${DB_NAME}"
log "starting node app"
exec node /app/app/server.mjs
