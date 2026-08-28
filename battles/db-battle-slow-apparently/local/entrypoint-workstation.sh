#!/bin/sh
# db-battle-slow-apparently — participant workstation entrypoint.
#
# This container is the Portal terminal target (metadata.json's
# `runtime.terminal.service`). It deliberately runs no server and holds no
# state: it exists so the participant gets a shell with `psql` and `node`
# WITHOUT also getting a shell inside the container that runs Postgres and
# the grader. See local/Dockerfile's banner for what that boundary is
# protecting (the Phase 1 answer key in grader/grade.mjs, and the scenario
# narration in db/schema.sql).
#
# Everything this container can do, it does over the compose network as the
# `participant` Postgres LOGIN role, whose grants (local/db/schema.sql) and
# pg_hba rules (local/entrypoint-primary.sh) are the real boundary.
set -eu

cat <<'BANNER'
[workstation] db-battle-slow-apparently

  psql -U participant -d incident              # the incident database (primary)
  psql -h replica -U participant -d incident   # the streaming standby (read-only)
  node bin/diagnose.mjs --pid ... --mechanism ... --trigger ... --first-action ...

BANNER

# Nothing to serve — stay up so `compose exec` has something to attach to.
exec tail -f /dev/null
