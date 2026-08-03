import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * A published port only exists if the container is on a network that can carry it.
 *
 * [TenkaCloud#347] `challenges/wp2shell-local-lab` declared
 * `ports: ["127.0.0.1:18080:8080", "127.0.0.1:18081:8081"]` and attached its only
 * service to a single `internal: true` network. Docker accepts that without a word:
 * it records `HostConfig.PortBindings`, then leaves `NetworkSettings.Ports` null and
 * establishes no host binding at all, because an internal network has no gateway to
 * NAT through. `docker ps` shows `8080-8081/tcp` — exposed, never published.
 *
 * The failure that produces is uniquely hard to read from the outside:
 *
 *   - the container starts, stays up, and reports `Up (healthy)`, because the compose
 *     healthcheck runs *inside* the container and never crosses the published port;
 *   - the platform's readiness probe (`waitForReachable`, a plain host-side `fetch`)
 *     gets ECONNREFUSED for its full 60s window and the launch ends in
 *     `lifecycle.status: error` with "Timed out waiting for verify endpoint";
 *   - teardown then removes the container, so the usual next step — read the logs —
 *     shows a perfectly healthy app.
 *
 * Nothing in the app, the Dockerfile, or the verifier is wrong in that state, which is
 * why it survived review: every artifact an author inspects is correct in isolation.
 * The defect is only visible in the relationship between two compose keys.
 *
 * The other two problems that use an internal network (`ai-riscv-screen-repair`,
 * `secure-ota-rollback`) already carry the fix — a second, non-internal bridge with
 * IP masquerade disabled, which carries inbound published traffic while still granting
 * no egress. So, as with the other catalog-wide guards, the correction existed and had
 * simply not reached every problem. This file is what makes it stay reached.
 *
 * Selected structurally (every `local/docker-compose.yml` under `challenges/` and
 * `battles/`), not by name, so a problem added tomorrow is covered the day it lands.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

interface ComposeFile {
  services?: Record<string, { ports?: unknown[]; networks?: string[] | Record<string, unknown> }>;
  networks?: Record<string, { internal?: boolean } | null>;
}

const COMPOSE_FILES = [
  ...globSync("challenges/*/local/docker-compose.yml", { cwd: REPO_ROOT }),
  ...globSync("battles/*/local/docker-compose.yml", { cwd: REPO_ROOT }),
].sort();

function compose(relative: string): ComposeFile {
  return (parseYaml(readFileSync(join(REPO_ROOT, relative), "utf8")) as ComposeFile) ?? {};
}

/** The networks a service joins, in either the list or the mapping form. */
function joinedNetworks(service: { networks?: string[] | Record<string, unknown> }): string[] {
  const declared = service.networks;
  if (Array.isArray(declared)) return declared;
  if (declared && typeof declared === "object") return Object.keys(declared);
  // No `networks:` key at all means compose's implicit default bridge, which is
  // not internal and publishes normally.
  return [];
}

describe("local-play published ports are actually established", () => {
  it("should find compose files to check, so a glob matching nothing cannot pass", () => {
    expect(COMPOSE_FILES.length).toBeGreaterThan(0);
  });

  it.each(COMPOSE_FILES)(
    "%s should keep every port-publishing service on a non-internal network",
    (relative) => {
      const file = compose(relative);
      const networks = file.networks ?? {};
      for (const [name, serviceRaw] of Object.entries(file.services ?? {})) {
        const service = serviceRaw ?? {};
        if ((service.ports ?? []).length === 0) continue;
        const joined = joinedNetworks(service);
        // No explicit networks => compose's default bridge => publishable.
        if (joined.length === 0) continue;
        for (const network of joined) {
          expect(
            Object.hasOwn(networks, network),
            `${relative}: service ${name} joins network "${network}", which the file never declares`,
          ).toBe(true);
        }
        expect(
          joined.some((network) => networks[network]?.internal !== true),
          `${relative}: service ${name} publishes ${JSON.stringify(service.ports)} but joins ` +
            `only internal networks (${joined.join(", ")}). Docker establishes no host binding ` +
            "for such a container, so the port is unreachable from the host and the platform's " +
            "/verify probe times out while the container reports healthy. Add a bridge network " +
            'with `com.docker.network.bridge.enable_ip_masquerade: "false"` alongside the ' +
            "internal one (see challenges/ai-riscv-screen-repair).",
        ).toBe(true);
      }
    },
  );
});
