# syntax=docker/dockerfile:1
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base
WORKDIR /app

FROM base AS participant
COPY --chown=node:node app/ ./app/
USER node
EXPOSE 8080
CMD ["node", "app/server.mjs"]

FROM base AS verifier
COPY --chown=node:node app/engine.mjs ./app/engine.mjs
COPY --chown=node:node verifier/ ./verifier/
USER node
EXPOSE 8081
CMD ["node", "verifier/server.mjs"]
