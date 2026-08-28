# syntax=docker/dockerfile:1
#
# The StackStack base image: one small message-board app shared by every problem
# in the StackStack family. A problem picks its scenario with SCENARIO=<name>
# and bind-mounts its own config/ over /app/config.
#
# The compose file of each problem binds every port to 127.0.0.1 only.
FROM node:22-alpine

WORKDIR /app

# Swagger UI をイメージに焼く。 CDN から読む方向は採らない — この板は loopback と
# Codespaces の転送ポートの両方から開かれ、 どちらも外へ出られる保証が無い。 外部を引くと
# 「動く環境と動かない環境がある」 という一番手間のかかる不具合になる。
# 配布物 11MB のうち実行に要るのは bundle と css だけなので、 その 2 つだけ移す。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && mkdir -p /app/vendor/swagger \
 && cp node_modules/swagger-ui-dist/swagger-ui-bundle.js /app/vendor/swagger/ \
 && cp node_modules/swagger-ui-dist/swagger-ui.css /app/vendor/swagger/ \
 && rm -rf node_modules package.json package-lock.json

COPY app/ ./
USER node

EXPOSE 8080 8081

CMD ["node", "server.mjs"]
