import { serve } from "@hono/node-server";
import { createUsersApp, type ServicePlatform } from "./app";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const platform = (process.env.PLATFORM ?? "ec2") as ServicePlatform;

serve({ fetch: createUsersApp(platform).fetch, port }, (info) => {
  console.log(`[users] listening on :${info.port} (platform=${platform})`);
});
