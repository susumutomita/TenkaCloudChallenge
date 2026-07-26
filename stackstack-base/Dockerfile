# syntax=docker/dockerfile:1
#
# The StackStack base image: one small message-board app shared by every problem
# in the StackStack family. A problem picks its scenario with SCENARIO=<name>
# and bind-mounts its own config/ over /app/config.
#
# The compose file of each problem binds every port to 127.0.0.1 only.
FROM node:22-alpine

WORKDIR /app
COPY app/ ./
USER node

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
