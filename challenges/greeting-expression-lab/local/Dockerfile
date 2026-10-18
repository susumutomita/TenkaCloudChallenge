FROM node:22-alpine AS base
WORKDIR /app
USER node

FROM base AS challenge
COPY --chown=node:node app/lab.mjs ./lab.mjs
EXPOSE 8080
CMD ["node", "lab.mjs"]

FROM base AS verifier
COPY --chown=node:node app/lab.mjs app/verifier.mjs ./
EXPOSE 8081
CMD ["node", "verifier.mjs"]
