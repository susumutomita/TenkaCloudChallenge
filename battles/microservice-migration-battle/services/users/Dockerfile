# users service — Microservice Migration Battle (Phase 1)
#
# Bun (oven/bun) ベース。3 サービス共通の構成。
# Lambda + API Gateway / ECS Fargate / App Runner のいずれにも乗せられる:
#   - Lambda: hono/aws-lambda adapter を追加 + entrypoint を handler に変える
#   - ECS Fargate / App Runner: 本 Dockerfile を ECR push → そのまま起動
#
# 競技中の再デプロイ高速化のため、依存と src を別レイヤに分けている。

FROM oven/bun:1-alpine AS deps
WORKDIR /app
# committed の bun.lock で再現性のある install (repo tooling は bun)。
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY package.json ./

EXPOSE 3001
# bun が TypeScript を直接実行 (ビルド工程不要、tsx/npx 不要)。
CMD ["bun", "run", "src/index.ts"]
