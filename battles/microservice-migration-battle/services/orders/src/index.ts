import { serve } from "@hono/node-server";
import { createOrdersApp, type ServicePlatform } from "./app";

const port = Number.parseInt(process.env.PORT ?? "3002", 10);
const platform = (process.env.PLATFORM ?? "ec2") as ServicePlatform;

serve({ fetch: createOrdersApp(platform).fetch, port }, (info) => {
  console.log(`[orders] listening on :${info.port} (platform=${platform})`);
});
