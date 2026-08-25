# syntax=docker/dockerfile:1
#
# db-battle-slow-apparently local-play container(s): 2 postgres:16-alpine
# builds from one Dockerfile — a "primary" (Postgres + Node info/verify/
# diagnosis, the terminal target) and a "replica" (Postgres-only hot standby).
# Same 2-stage shape as db-a11-replication-lag for the same reason: only
# `participant` needs Node, and `runtime.terminal.service` requires the
# exec'd service to be built with `target: participant`.
#
# Node comes from a `COPY --from=node:20-alpine` (not `apk add nodejs npm`):
# both images share the same Alpine/musl lineage, postgres:16-alpine already
# carries the couple of shared libs the node binary links against
# (libstdc++, libgcc_s — confirmed present on both images), and this avoids
# a second package-manager fetch entirely.
FROM node:20-alpine AS node_runtime

FROM postgres:16-alpine AS participant

COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node_runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app
COPY app/package.json ./app/package.json
RUN cd app && npm install --no-audit --no-fund --ignore-scripts

COPY app/ ./app/
COPY grader/ ./grader/
COPY db/ ./db/
COPY bin/ ./bin/
COPY entrypoint-primary.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Run unprivileged — `initdb` refuses to run as uid 0.
USER postgres

# 8080 = info surface, 8081 = loopback /verify + /diagnosis, 5432 = postgres
# (docker-network only — the terminal reaches it over 127.0.0.1 inside this
# same container).
EXPOSE 8080 8081 5432

ENTRYPOINT ["/app/entrypoint.sh"]

# ---------------------------------------------------------------------------

FROM postgres:16-alpine AS replica

WORKDIR /

COPY entrypoint-replica.sh /entrypoint-replica.sh
RUN chmod +x /entrypoint-replica.sh

USER postgres

EXPOSE 5432

ENTRYPOINT ["/entrypoint-replica.sh"]
