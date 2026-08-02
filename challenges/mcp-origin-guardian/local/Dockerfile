# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app
COPY app/ ./
USER node
EXPOSE 8080 8081
CMD ["node", "server.mjs"]
