# syntax=docker/dockerfile:1
#
# rls-tenant-isolation local-play container: Postgres + a small Node API and the
# /verify grader in one image. The compose file binds it to 127.0.0.1 only — it
# is a training target, never expose it off loopback.
#
# Postgres is the point of the problem (Row Level Security lives in the DB), so
# the image is Postgres-based with Node added for the app layer. This mirrors a
# Supabase project: PostgREST-style identity GUCs + RLS enforced in the database.
FROM postgres:16-alpine

# Node for the API + grader; install app deps (the `postgres` JS driver).
RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY app/package.json ./app/package.json
RUN cd app && npm install --no-audit --no-fund --ignore-scripts

COPY app/ ./app/
COPY grader/ ./grader/
COPY db/ ./db/
COPY solution/ ./solution/
COPY reference/ ./reference/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# 8080 = documents API (challenge surface), 8081 = loopback /verify.
EXPOSE 8080 8081

ENTRYPOINT ["/app/entrypoint.sh"]
