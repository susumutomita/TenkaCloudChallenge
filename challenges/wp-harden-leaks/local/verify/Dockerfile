# syntax=docker/dockerfile:1
#
# The "external scanner" / loopback scoring service for wp-harden-leaks. It holds NO
# secret — for each checkpoint it HTTP-probes the live WordPress container over the
# compose network and judges the hole CLOSED by the response. Bound to 127.0.0.1 only
# by the compose file.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

WORKDIR /app
COPY server.mjs ./
USER node

EXPOSE 8081

CMD ["node", "server.mjs"]
