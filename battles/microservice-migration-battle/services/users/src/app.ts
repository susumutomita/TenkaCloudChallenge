import { Hono } from "hono";

export type ServicePlatform = "ec2" | "lambda" | "ecs" | "apprunner";

const SERVICE_NAME = "users" as const;
const VERSION = "1.0.0";

function computeScore(): number {
  return 42;
}

function computeLegacyScore(): number {
  return 42;
}

export function createUsersApp(platform: ServicePlatform): Hono {
  const app = new Hono();
  app.get("/meta", (c) =>
    c.json({ service: SERVICE_NAME, platform, version: VERSION }),
  );
  app.get("/score", async (c) => {
    if (c.req.query("legacy") === "true") {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return c.json({ score: computeLegacyScore() });
    }
    return c.json({ score: computeScore() });
  });
  app.get("/healthz", (c) => c.json({ ok: true, service: SERVICE_NAME }));
  return app;
}
