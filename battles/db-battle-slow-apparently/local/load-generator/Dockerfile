# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app
COPY generate.mjs ./generate.mjs

USER node

CMD ["node", "generate.mjs"]
