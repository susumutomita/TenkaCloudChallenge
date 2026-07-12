import { serve } from "@hono/node-server";
import { createCatalogApp, type ServicePlatform } from "./app";

const port = Number.parseInt(process.env.PORT ?? "3003", 10);
const platform = (process.env.PLATFORM ?? "ec2") as ServicePlatform;

serve({ fetch: createCatalogApp(platform).fetch, port }, (info) => {
  console.log(`[catalog] listening on :${info.port} (platform=${platform})`);
});
