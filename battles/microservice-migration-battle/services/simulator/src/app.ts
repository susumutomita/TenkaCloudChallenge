import { Hono } from "hono";
import { createCatalogApp } from "../../catalog/src/app";
import { createOrdersApp } from "../../orders/src/app";
import { createUsersApp } from "../../users/src/app";

export function createMigrationGateway(): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/users", createUsersApp("ec2"));
  app.route("/orders", createOrdersApp("ec2"));
  app.route("/catalog", createCatalogApp("ec2"));
  return app;
}
