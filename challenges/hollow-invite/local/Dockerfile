# syntax=docker/dockerfile:1
#
# Isolated IR-GameDay mock for TenkaCloud local play (Operation "Hollow Invite").
# This is NOT a vulnerable app — it is the investigation tenant. The compose file
# binds it to 127.0.0.1 only, and the app performs no external egress.
FROM node:22-alpine

WORKDIR /app
COPY app/ ./
USER node

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
