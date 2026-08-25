# syntax=docker/dockerfile:1
#
# db-battle-slow-apparently — order API. Plain Node 20 + the `postgres`
# driver, no framework: this Battle's subject is Postgres/production
# behaviour, not the web framework, matching the rest of the Database Track's
# style.
FROM node:20-alpine

WORKDIR /app
COPY package.json ./package.json
RUN npm install --no-audit --no-fund --ignore-scripts

COPY server.mjs ./server.mjs

EXPOSE 3000

USER node

CMD ["node", "server.mjs"]
