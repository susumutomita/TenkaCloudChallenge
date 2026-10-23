FROM node:22-alpine AS surface
WORKDIR /lab
COPY app/model.mjs app/server.mjs app/index.html ./app/
USER node
EXPOSE 8080
ENV BIND=0.0.0.0
CMD ["node", "app/server.mjs"]

FROM node:22-alpine AS verifier
WORKDIR /lab
COPY app/model.mjs ./app/model.mjs
COPY verify/ ./verify/
USER node
EXPOSE 8081
ENV BIND=0.0.0.0
CMD ["node", "verify/server.mjs"]
