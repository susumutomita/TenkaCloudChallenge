FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
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
