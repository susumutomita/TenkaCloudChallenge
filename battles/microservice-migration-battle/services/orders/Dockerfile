# orders service — Microservice Migration Battle (Phase 1)
# users / catalog と同型。詳細は users/Dockerfile のヘッダを参照。

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY package.json ./

EXPOSE 3002
CMD ["bun", "run", "src/index.ts"]
