# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9

FROM ${BUN_IMAGE} AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY users/package.json ./users/package.json
COPY orders/package.json ./orders/package.json
COPY catalog/package.json ./catalog/package.json
COPY simulator/package.json ./simulator/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/simulator/node_modules ./simulator/node_modules
COPY --from=dependencies /app/users/node_modules ./users/node_modules
COPY --from=dependencies /app/orders/node_modules ./orders/node_modules
COPY --from=dependencies /app/catalog/node_modules ./catalog/node_modules
COPY simulator/package.json ./simulator/package.json
COPY simulator/src ./simulator/src
COPY users/src/app.ts ./users/src/app.ts
COPY orders/src/app.ts ./orders/src/app.ts
COPY catalog/src/app.ts ./catalog/src/app.ts

ENV PORT=8080
EXPOSE 8080
USER 65532:65532
CMD ["bun", "run", "simulator/src/index.ts"]
