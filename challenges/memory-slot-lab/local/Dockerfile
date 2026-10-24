FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS surface
WORKDIR /lab
COPY app/model.mjs app/server.mjs app/index.html ./app/
USER node
EXPOSE 8080
ENV BIND=0.0.0.0
CMD ["node", "app/server.mjs"]

FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS verifier
WORKDIR /lab
COPY app/model.mjs ./app/model.mjs
COPY verify/ ./verify/
USER node
EXPOSE 8081
ENV BIND=0.0.0.0
CMD ["node", "verify/server.mjs"]
