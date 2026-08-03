import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * wp2shell-local-lab is a from-scratch simulator (see AGENT.md's hard safety
 * boundary: never ship a genuinely vulnerable release, never a reusable
 * real-world payload, and the local lab must be provably egress- and
 * exec-free). This file is the automated proof the issue asked for: it fails
 * the build if the shipped source ever gains a shell/exec/eval call, if the
 * compose network ever gains an outbound route, or if a port is ever
 * published beyond loopback.
 *
 * These are STATIC checks only (source text + docker-compose.yml structure).
 * The exploit-chain / remediation logic itself was verified by hand by
 * actually running `local/app/server.mjs` as a real process end to end
 * (documented in the PR body) rather than in this suite, because the app
 * intentionally depends on `node:sqlite` (Node 22.5+, `--experimental-sqlite`)
 * for a real, minimal query builder that a real injection can manipulate --
 * this repo's CI only provisions Bun (`oven-sh/setup-bun`), and Bun 1.3.11
 * does not implement `node:sqlite`, so spawning the app inside this test
 * suite would fail in CI for a runtime-availability reason unrelated to the
 * problem's correctness, not a real regression. Docker (which players and
 * `make local` actually use) ships real Node.js 22 and is unaffected.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "wp2shell-local-lab");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function metadata() {
  return JSON.parse(read("metadata.json")) as {
    scoring: { kind: string; checks: Array<Record<string, unknown>> };
    runtime: { provider: string; engine: string; entry: string };
  };
}

// NOTE: a bare `exec(` is deliberately NOT in this list -- node:sqlite's
// `db.exec(sql)` (used by this app to create its in-memory tables) and
// RegExp#exec() are both legitimate, unrelated APIs that would false-positive
// on that pattern. The only way to get real process-execution capability is
// importing node:child_process (or a module built on it), which IS checked.
const FORBIDDEN_EXEC_PATTERNS = [
  /child_process/,
  /\bexecSync\s*\(/,
  /\bspawn\s*\(/,
  /\bspawnSync\s*\(/,
  /\bfork\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
];

/**
 * Strips `//` and `/* *\/` comments so the exec/eval scan below judges actual
 * code, not the file's own doc comments explaining what it does NOT do (which
 * would otherwise false-positive on the words "child_process" / "eval" etc.
 * appearing in prose).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("wp2shell-local-lab catalog contract", () => {
  it("should ship every required local-play artifact", () => {
    for (const file of [
      "metadata.json",
      "README.md",
      "README.ja.md",
      "diagram.svg",
      "local/Dockerfile",
      "local/docker-compose.yml",
      "local/app/server.mjs",
    ]) {
      expect(existsSync(join(ROOT, file)), `missing ${file}`).toBe(true);
    }
  });

  it("should declare a docker/compose runtime with no cfnTemplate", () => {
    const value = metadata();
    expect(value.runtime).toEqual({
      provider: "docker",
      engine: "compose",
      entry: "local/docker-compose.yml",
      challengeEndpoints: { Web: "http://127.0.0.1:18080" },
      verifyUrl: "http://127.0.0.1:18081/verify",
      secretEnv: ["FLAG_SEED"],
    });
  });

  it("should declare exactly the 8 multi-verify checkpoints the issue asked for, summing to the Hard tier (300 pts)", () => {
    const value = metadata();
    expect(value.scoring.kind).toBe("multi-verify");
    const ids = value.scoring.checks.map((c) => c.id);
    expect(ids).toEqual([
      "chain-discovery",
      "compromise-proof",
      "fix-route",
      "fix-query",
      "cleanup-persistence",
      "rotate-secrets",
      "replay-blocked",
      "site-healthy",
    ]);
    const total = value.scoring.checks.reduce((sum, c) => sum + (c.points as number), 0);
    expect(total).toBe(300);
  });

  it("should reference every checkpoint id inside the shipped simulator's CHECKS table", () => {
    const server = read("local/app/server.mjs");
    const value = metadata();
    for (const check of value.scoring.checks) {
      expect(server, `server.mjs must implement checkpoint "${check.id}"`).toContain(
        `"${check.id}":`,
      );
    }
  });

  it("should never call a shell, exec, spawn, or eval anywhere in the shipped simulator", () => {
    const code = stripComments(read("local/app/server.mjs"));
    for (const pattern of FORBIDDEN_EXEC_PATTERNS) {
      expect(
        pattern.test(code),
        `forbidden exec-capable pattern ${pattern} found in local/app/server.mjs`,
      ).toBe(false);
    }
  });

  it("should never fetch or connect anywhere outside its own loopback port", () => {
    const server = read("local/app/server.mjs");
    // Every fetch() target in this file must be the app's own loopback --
    // constructed from CHALLENGE_PORT, never a literal external host.
    const fetchCalls = [...server.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
    expect(fetchCalls.length).toBeGreaterThan(0); // the verify self-probes must exist
    for (const call of fetchCalls) {
      expect(call).toContain("127.0.0.1:${CHALLENGE_PORT}");
    }
  });

  it("should give the app no route out of its compose networks, on every network it joins", () => {
    // [TenkaCloud#347] This used to assert `networks.length === 1` and
    // `service.networks === [labnet]`. That shape is egress-free AND
    // unreachable: Docker establishes no host port binding at all for a
    // container attached only to internal networks, so `ports:` above was inert
    // and the platform's /verify probe timed out on every launch while the
    // in-container healthcheck reported `Up (healthy)`.
    //
    // The real invariant is not "exactly one network", it is "no network the
    // app joins can carry a packet out". So: the lab network stays
    // `internal: true`, and any additional network exists only to carry the
    // inbound published-port path and must be a bridge with IP masquerade
    // disabled (no SNAT => an egress packet has no return route) and its host
    // binding pinned to loopback. That is the arrangement
    // challenges/ai-riscv-screen-repair and challenges/secure-ota-rollback
    // already ship, and it is strictly more specific than a network count.
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<
        string,
        { networks?: string[]; ports?: string[]; privileged?: boolean; cap_add?: unknown }
      >;
      networks: Record<
        string,
        { internal?: boolean; driver?: string; driver_opts?: Record<string, string> }
      >;
    };
    const networkNames = Object.keys(compose.networks ?? {});
    expect(networkNames.length).toBeGreaterThan(0);

    const internalNames = networkNames.filter((name) => compose.networks[name].internal === true);
    expect(internalNames.length, "at least one network must be internal: true").toBeGreaterThan(0);

    for (const name of networkNames) {
      const network = compose.networks[name];
      if (network.internal === true) continue;
      // A non-internal network is allowed for one reason only: published ports.
      expect(network.driver, `network ${name} must be an explicit bridge`).toBe("bridge");
      expect(
        network.driver_opts?.["com.docker.network.bridge.enable_ip_masquerade"],
        `network ${name} must disable IP masquerade, or it grants the lab egress`,
      ).toBe("false");
      expect(
        network.driver_opts?.["com.docker.network.bridge.host_binding_ipv4"],
        `network ${name} must pin its host binding to loopback`,
      ).toBe("127.0.0.1");
    }

    for (const [name, service] of Object.entries(compose.services)) {
      expect(service.networks, `service ${name} must declare networks`).toBeDefined();
      expect(
        service.networks?.length,
        `service ${name} must declare at least one network`,
      ).toBeGreaterThan(0);
      for (const joined of service.networks ?? []) {
        expect(networkNames, `service ${name} joins undeclared network ${joined}`).toContain(joined);
      }
      // Every service still sits on the internal lab network; the publish-only
      // bridge is an addition to it, never a replacement for it.
      expect(
        service.networks?.some((joined) => compose.networks[joined]?.internal === true),
        `service ${name} must stay on an internal network`,
      ).toBe(true);
      expect(service.privileged, `service ${name} must not be privileged`).toBeFalsy();
      expect(service.cap_add, `service ${name} must not add capabilities`).toBeUndefined();
    }
  });

  it("should attach every port-publishing service to a non-internal network, or the publish is inert", () => {
    // [TenkaCloud#347] The half the old test could not see. Docker records
    // HostConfig.PortBindings for an internal-only container but leaves
    // NetworkSettings.Ports null, so `docker ps` shows `8080-8081/tcp` with no
    // `127.0.0.1:...->` arrow and nothing on the host can connect. This is the
    // exact assertion that turns that silent failure into a red test.
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { networks?: string[]; ports?: string[] }>;
      networks: Record<string, { internal?: boolean }>;
    };
    for (const [name, service] of Object.entries(compose.services)) {
      if ((service.ports ?? []).length === 0) continue;
      expect(
        service.networks?.some((joined) => compose.networks[joined]?.internal !== true),
        `service ${name} publishes ports but joins only internal networks, ` +
          "so Docker will establish no host binding and /verify is unreachable",
      ).toBe(true);
    }
  });

  it("should publish every port to 127.0.0.1 only, never 0.0.0.0 or a bare port", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    let sawAnyPort = false;
    for (const [name, service] of Object.entries(compose.services)) {
      for (const mapping of service.ports ?? []) {
        sawAnyPort = true;
        expect(
          String(mapping).startsWith("127.0.0.1:"),
          `service ${name} port mapping "${mapping}" must be bound to 127.0.0.1`,
        ).toBe(true);
      }
    }
    expect(sawAnyPort).toBe(true);
  });

  it("should never bind mount a host path or the docker socket", () => {
    const composeText = read("local/docker-compose.yml");
    expect(composeText).not.toContain("/var/run/docker.sock");
    const compose = parseYaml(composeText) as {
      services: Record<string, { volumes?: string[] }>;
    };
    for (const [name, service] of Object.entries(compose.services)) {
      for (const volume of service.volumes ?? []) {
        // A host bind mount contains a path separator before the colon (e.g.
        // "./x:/y" or "/abs:/y"); a named volume does not (e.g. "wp_data:/y").
        // This service ships no volumes at all today, but the guard stays in
        // place for future edits.
        expect(
          /^[./~]/.test(String(volume)),
          `service ${name} volume "${volume}" looks like a host bind mount`,
        ).toBe(false);
      }
    }
  });

  it("should derive both stage-1 flags and the SRE token from FLAG_SEED, never a literal secret", () => {
    const server = read("local/app/server.mjs");
    expect(server).toContain('process.env.FLAG_SEED ?? "local-dev-seed"');
    expect(server).toMatch(/flagFor\("chain-discovery"/);
    expect(server).toMatch(/flagFor\("compromise-proof"/);
    expect(server).toContain("sre-token:v");
  });

  it("should keep JA/EN parity for every check label and hint (ja/en drift check)", () => {
    const value = metadata() as unknown as {
      i18n: { en: { checks: Array<{ id: string; label: string; hints: Array<{ id: string }> }> } };
      scoring: { checks: Array<{ id: string; label: string; hints: Array<{ id: string }> }> };
    };
    const enById = new Map(value.i18n.en.checks.map((c) => [c.id, c]));
    for (const check of value.scoring.checks) {
      const en = enById.get(check.id);
      expect(en, `missing i18n.en.checks entry for "${check.id}"`).toBeDefined();
      expect(en?.label.length).toBeGreaterThan(0);
      const jaHintIds = check.hints.map((h) => h.id).sort();
      const enHintIds = (en?.hints ?? []).map((h) => h.id).sort();
      expect(enHintIds).toEqual(jaHintIds);
    }
  });
});
