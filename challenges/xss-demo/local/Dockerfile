# syntax=docker/dockerfile:1
#
# Deliberately vulnerable training target for TenkaCloud local play.
# The compose file binds it to 127.0.0.1 only — never expose it off loopback.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

WORKDIR /app
COPY app/ ./
USER node

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
