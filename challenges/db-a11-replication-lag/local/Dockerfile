# syntax=docker/dockerfile:1
#
# db-a11-replication-lag local-play container(s): 2 postgres:16-alpine builds
# from one Dockerfile — a "primary" (Postgres + Node info/verify, same shape
# as db-a1..a8/a12) and a "replica" (Postgres only, boots as a hot standby via
# pg_basebackup against the primary — see entrypoint-replica.sh). Same 2-node
# shape as db-a10-primary-replica, this drill's prerequisite (see
# docs/curricula/database-track/curriculum.md) — this problem is deployed
# independently, with its own topology, not sharing containers with A10.
#
# Two stages instead of one because the two roles need different things: only
# `participant` needs Node (it serves the info page and /verify) and only it
# is the terminal target (SCHEMA.json's `runtime.terminal.service` requires
# `target: participant`). `replica` stays Postgres-only — smaller image,
# and it is never exec'd into by a participant.
FROM postgres:16-alpine AS participant

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY app/package.json ./app/package.json
RUN cd app && npm install --no-audit --no-fund --ignore-scripts

COPY app/ ./app/
COPY grader/ ./grader/
COPY db/ ./db/
COPY entrypoint-primary.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Run unprivileged — required, not just hygiene: `initdb` refuses to run as
# uid 0, so a root entrypoint would kill the container on its first boot
# before anything ever listens.
USER postgres

# 8080 = info surface, 8081 = loopback /verify, 5432 = postgres (docker-network
# only — not published for this service; the terminal reaches it over the
# unix socket / 127.0.0.1 inside this same container).
EXPOSE 8080 8081 5432

ENTRYPOINT ["/app/entrypoint.sh"]

# ---------------------------------------------------------------------------

FROM postgres:16-alpine AS replica

WORKDIR /

COPY entrypoint-replica.sh /entrypoint-replica.sh
RUN chmod +x /entrypoint-replica.sh

USER postgres

# 5432 = postgres, published to the host so participants can connect to the
# standby directly (in addition to reaching it from the primary's terminal
# via the compose service name `replica`).
EXPOSE 5432

ENTRYPOINT ["/entrypoint-replica.sh"]
