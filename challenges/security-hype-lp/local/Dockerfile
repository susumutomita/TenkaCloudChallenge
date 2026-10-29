# syntax=docker/dockerfile:1
#
# security-hype-lp: a fictional vendor landing page to analyse, plus a separate verifier.
# The participant image carries only the allowlisted public-artifact forwarder.
# Scenario, seed, renderer, answer mapping and verifier stay private to the verifier image.
# Compose binds both published ports to 127.0.0.1.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
WORKDIR /app
USER node

FROM base AS challenge
COPY --chown=node:node app/site.mjs ./
EXPOSE 8080
CMD ["node", "site.mjs"]

FROM base AS verifier
COPY --chown=node:node app/scenario.mjs app/answers.mjs app/presentation.mjs app/verifier.mjs ./
EXPOSE 8081
CMD ["node", "verifier.mjs"]
