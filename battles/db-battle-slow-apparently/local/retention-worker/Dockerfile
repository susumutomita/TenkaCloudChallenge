# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app
COPY package.json ./package.json
RUN npm install --no-audit --no-fund --ignore-scripts

COPY worker.mjs ./worker.mjs

USER node

CMD ["node", "worker.mjs"]
