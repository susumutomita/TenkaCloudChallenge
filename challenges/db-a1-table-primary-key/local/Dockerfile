# syntax=docker/dockerfile:1
#
# db-a1-table-primary-key local-play container: Postgres + a small Node info/verify
# pair in one image. The compose file binds it to 127.0.0.1 only.
#
# Postgres IS the point of the drill (table / row / primary key is a database-engine
# concept, not an application-layer one), so the image is Postgres-based with Node
# added only for the participant-facing info page and the /verify grader that reads
# live database state. `psql` ships in the base image already.
#
# Named "participant" because `runtime.terminal` (SCHEMA.json) requires the exec'd
# compose service to be built from a stage with exactly this name.
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

# Run unprivileged — required, not just hygiene: `initdb` refuses to run as uid 0
# ("initdb: error: cannot be run as root"), so a root entrypoint would kill the
# container on its first boot before anything ever listens.
USER postgres

# 8080 = info surface, 8081 = loopback /verify.
EXPOSE 8080 8081

ENTRYPOINT ["/app/entrypoint.sh"]
