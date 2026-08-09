# syntax=docker/dockerfile:1
#
# `agent-approval-gameday` — the incident, the tool gateway and the verifier.
#
# One image, two entrypoints. The workbench and the verifier share the world in a
# single process because the verifier grades live state (`posture` recomputes on every
# request) rather than a stored answer — splitting them would mean shipping the state
# across a boundary and getting two sources of truth for it.
#
# The compose file binds both ports to 127.0.0.1 only, drops every capability, mounts
# the root filesystem read-only and gives the container no external network. Nothing in
# the problem needs to reach the internet, and an incident-response exercise where the
# sandbox can call out is teaching the wrong reflex.
FROM node:22-alpine

WORKDIR /app
COPY app/ ./
USER node

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
