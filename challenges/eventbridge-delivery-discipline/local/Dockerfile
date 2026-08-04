# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
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
