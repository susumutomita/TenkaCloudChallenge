# syntax=docker/dockerfile:1
#
# db-battle-slow-apparently local-play images.
#
# THREE build stages, and the participant/grading split is a boundary, not an
# image-size optimisation — same shape as challenges/cs-atomic-file-publish's
# participant/verifier split:
#
#   participant -- the ONLY image a participant gets a shell on (compose
#                  service `workstation`; metadata.json's
#                  runtime.terminal.service, which the docker adapter refuses
#                  to attach to unless the service is built `target:
#                  participant`). It carries psql, node, and the Phase 1
#                  submission CLI. It carries NO grader/, NO db/, NO app/:
#                  grader/grade.mjs holds the Phase 1 answer key
#                  (MECHANISM_CORRECT / TRIGGER_CORRECT /
#                  FIRST_ACTION_CORRECT), the purge-target partition list and
#                  the widened cutoff, and db/schema.sql narrates the entire
#                  incident in its banner comments. Shipping either into the
#                  terminal image hands the participant the answers on a
#                  `cat` (AGENTS.md, "Repository boundary": never expose
#                  hidden checks or reference answers in participant images).
#   primary     -- Postgres 16 (initialised from db/schema.sql + db/seed.sql)
#                  + the Node info/verify/diagnosis surface + grader/. This
#                  is where grading runs, so it is the only image grading
#                  material is copied into, and no shell is handed out here.
#   replica     -- Postgres-only hot standby. Never exec'd into, needs no Node.
#
# Node comes from a `COPY --from=node:20-alpine` (not `apk add nodejs npm`):
# both images share the same Alpine/musl lineage, postgres:16-alpine already
# carries the couple of shared libs the node binary links against
# (libstdc++, libgcc_s — confirmed present on both images), and this avoids
# a second package-manager fetch entirely.
FROM node:20-alpine AS node_runtime

# Shared base for the two images that need a Postgres client plus Node. Also
# why `participant` stays on postgres:16-alpine rather than a slimmer
# alpine + postgresql16-client: it makes the terminal image share every layer
# below this line with `primary`, so the split costs no extra pull.
FROM postgres:16-alpine AS pgbase

COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node

# ---------------------------------------------------------------------------
# participant — the workstation the Portal terminal attaches to.
#
# Everything reachable from here is reached over the compose network as an
# ordinary Postgres LOGIN role with revocable grants; there is no local
# postmaster, no PGDATA, and no superuser socket (see entrypoint-primary.sh's
# pg_hba rules).
# ---------------------------------------------------------------------------
FROM pgbase AS participant

RUN adduser -D -u 10001 lab

WORKDIR /app
COPY --chown=lab:lab bin/ ./bin/
COPY --chown=lab:lab entrypoint-workstation.sh /entrypoint-workstation.sh
RUN chmod +x /entrypoint-workstation.sh

# Makes the documented `psql -U participant -d incident` and
# `node bin/diagnose.mjs ...` work verbatim from this container, now that the
# server and the intake endpoint live in the `primary` service.
ENV PGHOST=primary \
    PGPORT=5432 \
    PGUSER=participant \
    PGDATABASE=incident \
    DIAGNOSIS_URL=http://primary:8081/diagnosis

USER lab

ENTRYPOINT ["/entrypoint-workstation.sh"]

# ---------------------------------------------------------------------------
# primary — Postgres + the grading surface. Not a terminal target.
# ---------------------------------------------------------------------------
FROM pgbase AS primary

COPY --from=node_runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app
COPY app/package.json ./app/package.json
RUN cd app && npm install --no-audit --no-fund --ignore-scripts

COPY app/ ./app/
COPY grader/ ./grader/
COPY db/ ./db/
COPY entrypoint-primary.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Run unprivileged — `initdb` refuses to run as uid 0.
USER postgres

# 8080 = info surface, 8081 = /verify + /diagnosis, 5432 = postgres. 8081 and
# 5432 are reachable from the compose network (the workstation submits its
# diagnosis and runs psql across it); only 8080/8081 are published to the
# host, and only on 127.0.0.1 (see docker-compose.yml).
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
