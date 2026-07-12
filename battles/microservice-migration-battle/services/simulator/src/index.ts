import { createMigrationGateway } from "./app";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: createMigrationGateway().fetch,
});

console.log(`[migration-gateway] listening on :${server.port}`);
