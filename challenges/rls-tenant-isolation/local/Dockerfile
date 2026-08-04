# syntax=docker/dockerfile:1
#
# rls-tenant-isolation local-play container: Postgres + a small Node API and the
# /verify grader in one image. The compose file binds it to 127.0.0.1 only — it
# is a training target, never expose it off loopback.
#
# Postgres is the point of the problem (Row Level Security lives in the DB), so
# the image is Postgres-based with Node added for the app layer. This mirrors a
# Supabase project: PostgREST-style identity GUCs + RLS enforced in the database.
FROM postgres:16-alpine AS participant

# Node for the API + grader; install app deps (the `postgres` JS driver).
RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY app/package.json ./app/package.json
RUN cd app && npm install --no-audit --no-fund --ignore-scripts

COPY app/ ./app/
COPY grader/ ./grader/
COPY db/ ./db/
COPY solution/ ./solution/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Run unprivileged, like every other local-play image in this catalog
# (`USER node` in sqli-demo / wp2shell-local-lab, `USER lab` in ai-riscv-*).
#
# For a Postgres-based image this is not only convention, it is required:
# `initdb` refuses to run as uid 0 ("initdb: error: cannot be run as root"), so
# a root entrypoint kills the container on its very first boot before either
# server ever listens. The official image papers over this by re-exec'ing its own
# docker-entrypoint.sh through `su-exec postgres`; this problem replaces that
# entrypoint wholesale, so the drop has to happen here instead.
#
# uid 70 (`postgres`) already owns $PGDATA (/var/lib/postgresql/data, mode 1777)
# and the socket dir in the base image, and /app is world-readable, so nothing
# else needs a chown.
USER postgres

# 8080 = documents API (challenge surface), 8081 = loopback /verify.
EXPOSE 8080 8081

ENTRYPOINT ["/app/entrypoint.sh"]

# The reference answer is author-only. Compose and the platform explicitly
# build `participant`, so the image handed to a learner does not contain it.
FROM participant AS author
COPY reference/ ./reference/
