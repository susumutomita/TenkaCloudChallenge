import { describe, expect, it } from "bun:test";
import { createMigrationGateway } from "./app";

describe("microservice migration simulator workload", () => {
  it("同じ3 service appをEC2 pathから実HTTP responseとして公開する", async () => {
    const app = createMigrationGateway();
    const expected = [
      ["users", 42],
      ["orders", 7],
      ["catalog", 99],
    ] as const;
    for (const [service, score] of expected) {
      expect(await (await app.request(`/${service}/meta`)).json()).toEqual({
        service,
        platform: "ec2",
        version: "1.0.0",
      });
      expect(await (await app.request(`/${service}/score`)).json()).toEqual({
        score,
      });
      expect((await app.request(`/${service}/healthz`)).status).toBe(200);
    }
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/unknown")).status).toBe(404);
  });
});
