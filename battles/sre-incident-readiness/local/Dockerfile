# syntax=docker/dockerfile:1
#
# `sre-incident-readiness` — the order service, the Workbench and the verifier.
#
# One image, two entrypoints, same reasoning as `agent-approval-gameday`: the verifier
# grades live state (`posture()` recomputes from `world` on every request) rather than
# a stored answer, so splitting workbench and verifier into separate processes would
# mean shipping that state across a boundary and inventing a second source of truth
# for it. No dependencies beyond Node's own `node:http` / `node:crypto` — nothing to
# install, nothing to audit for a supply-chain surface.
FROM node:22-alpine

WORKDIR /app
COPY app/ ./
USER node

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
