# syntax=docker/dockerfile:1
#
# db-challenge-blocked-transaction local-play container: Postgres + a small
# Node info/verify pair in one image. The compose file binds it to
# 127.0.0.1 only.
#
# Postgres IS the point of this Challenge (pg_stat_activity / pg_locks /
# pg_blocking_pids() / pg_terminate_backend and the row-lock semantics behind
# them are engine internals), so the image is Postgres-based with Node added
# only for the info page, the /verify grader, and the background app-role
# connections that orchestrate the incident. `psql` ships in the base image.
#
# Named "participant" because `runtime.terminal` (SCHEMA.json) requires the
# exec'd compose service to be built from a stage with exactly this name.
FROM postgres:16-alpine AS participant

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY app/package.json ./app/package.json
RUN cd app && npm install --no-audit --no-fund --ignore-scripts

COPY app/ ./app/
COPY grader/ ./grader/
COPY db/ ./db/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Run unprivileged — required, not just hygiene: `initdb` refuses to run as
# uid 0, so a root entrypoint would kill the container on its first boot
# before anything ever listens.
USER postgres

# 8080 = info surface, 8081 = loopback /verify.
EXPOSE 8080 8081

ENTRYPOINT ["/app/entrypoint.sh"]
