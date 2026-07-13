# One dependency-free Node image serves every isolated component. SERVICE_ROLE
# selects signing, OTA, bus, TCU, or one of the two ECU processes.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

WORKDIR /app
COPY app/*.mjs ./

USER node

CMD ["node", "server.mjs"]
