FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node app ./app
COPY --chown=node:node public ./public
USER node
CMD ["node", "app/server.mjs"]
