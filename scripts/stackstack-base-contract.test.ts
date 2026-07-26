import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * The contract `stackstack-base` offers its scenarios.
 *
 * Eight problems run this one app, so the seam between "the board" and "what
 * this problem adds" is the thing that decides whether the family stays a
 * family. If a scenario cannot add its own route, every problem grows a branch
 * in `server.mjs` and the shared board quietly becomes a platform; if a gate
 * cannot hand out a receipt, every problem invents its own way to say "this
 * really happened" and the checkpoints stop being comparable.
 *
 * These tests drive a throwaway scenario written into the scenarios directory
 * and removed afterwards, rather than shipping a fixture scenario in the image —
 * a test scenario in the image would be a live, unlisted route surface in every
 * participant's container.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_DIR = join(REPO_ROOT, "stackstack-base", "app", "scenarios");
const SEED = "stackstack-base-contract-seed";

/** A scenario that exercises every part of the contract at once. */
const PROBE_SCENARIO = `
export const gateTokens = true;

export const seedPosts = [
  { author: "seed", title: "shipped with the board", body: "", at: "2026-04-06T09:00:00.000Z" },
];

let flipped = false;

export const gates = {
  // Measured from the app, like every real scenario's gates.
  probe_called: (context) => context.observed.has("GET /api/probe"),
  probe_flipped: () => flipped,
};

export const routes = {
  "GET /api/probe": (request, response, url) => {
    if (url.searchParams.get("flip") === "yes") flipped = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ probe: "ok", flipped }));
  },
  // Answers, then raises outside the request — the shape guard() cannot catch.
  "GET /api/probe-fault": (request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ scheduled: true }));
    setTimeout(() => Promise.reject(new Error("probe fault")), 10);
  },
};

export const checks = {
  "probe-check": (submission) => submission.trim() === "probe-answer",
};
`;

/** A scenario that tries to take over a route the board itself owns. */
const SHADOW_SCENARIO = `
export const gates = { always: () => true };
export const routes = { "GET /healthz": (request, response) => response.end("hijacked") };
export const checks = {};
`;

interface Started {
  readonly process: ReturnType<typeof spawn>;
  readonly stderr: () => string;
  readonly exited: Promise<number | null>;
}

function start(scenario: string, ports: { challenge: number; verify: number }): Started {
  let stderr = "";
  const child = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: scenario,
      FLAG_SEED: SEED,
      APP_CONFIG: join(scratch, "app.json"),
      CHALLENGE_PORT: String(ports.challenge),
      VERIFY_PORT: String(ports.verify),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return {
    process: child,
    stderr: () => stderr,
    exited: new Promise((resolve) => child.on("exit", (code) => resolve(code))),
  };
}

async function waitForBoard(port: number, deadlineMs = 4_000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

let scratch = "";
const written: string[] = [];

function writeScenario(name: string, source: string): void {
  const path = join(SCENARIO_DIR, `${name}.mjs`);
  writeFileSync(path, source);
  written.push(path);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-base-contract-"));
  writeFileSync(
    join(scratch, "app.json"),
    JSON.stringify({ boardTitle: "contract", acceptingPosts: true }),
  );
  writeScenario("__probe", PROBE_SCENARIO);
  writeScenario("__shadow", SHADOW_SCENARIO);
});

afterAll(() => {
  for (const path of written) rmSync(path, { force: true });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("a scenario can add its own routes", () => {
  const port = 18240;
  const verifyPort = 18241;
  let app: Started;

  beforeAll(async () => {
    app = start("__probe", { challenge: port, verify: verifyPort });
    expect(await waitForBoard(port), `did not come up: ${app.stderr().slice(0, 300)}`).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should dispatch a route the scenario declared", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/probe`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ probe: "ok" });
  });

  it("should hand the scenario the parsed url, query string and all", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/probe?flip=yes`);
    expect((await response.json()) as { flipped: boolean }).toMatchObject({ flipped: true });
  });

  it("should still serve the board's own routes", async () => {
    for (const path of ["/", "/healthz", "/api/board", "/api/logs", "/posture"]) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(200);
    }
  });

  it("should still 404 a route nobody declared", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/api/not-declared`)).status).toBe(404);
  });

  it("should observe a scenario route, so its gates can measure it", async () => {
    const posture = (await (await fetch(`http://127.0.0.1:${port}/posture`)).json()) as {
      gates: Record<string, boolean>;
    };
    expect(posture.gates.probe_called).toBe(true);
  });

  it("should keep the scenario's own seed posts distinguishable from a participant's", async () => {
    const board = (await (await fetch(`http://127.0.0.1:${port}/api/board`)).json()) as {
      posts: Array<{ seeded: boolean; title: string }>;
    };
    expect(board.posts.every((post) => post.seeded)).toBe(true);
  });
});

describe("gate receipts", () => {
  const port = 18242;
  const verifyPort = 18243;
  let app: Started;

  beforeAll(async () => {
    app = start("__probe", { challenge: port, verify: verifyPort });
    expect(await waitForBoard(port)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  const posture = async () =>
    (await (await fetch(`http://127.0.0.1:${port}/posture`)).json()) as {
      gates: Record<string, boolean>;
      tokens: Record<string, string | null>;
      readyToken: string | null;
    };

  it("should withhold a gate's token while that gate is false", async () => {
    // Asked through a route that is not the probe, so looking does not itself
    // satisfy the gate under test.
    const before = await posture();
    expect(before.gates.probe_flipped).toBe(false);
    expect(before.tokens.probe_flipped).toBeNull();
  });

  it("should emit a token once its gate turns true, and only for that gate", async () => {
    await fetch(`http://127.0.0.1:${port}/api/probe?flip=yes`);
    const after = await posture();
    expect(after.gates.probe_flipped).toBe(true);
    expect(after.tokens.probe_flipped).toMatch(/^TC\{probe_flipped_[0-9a-f]{16}\}$/);
    // Distinct per gate: earning one must not reveal another.
    expect(after.tokens.probe_called).not.toBe(after.tokens.probe_flipped);
  });

  it("should not derive a receipt from anything reachable inside the container", async () => {
    // FLAG_SEED arrives in the environment, and on Linux /proc/self/environ
    // keeps the exec-time copy no matter what is deleted from process.env — so
    // participant code running in the app (which later problems in this family
    // do on purpose) could recompute any FLAG_SEED-derived value. A receipt
    // asserts the app observed something; it must not be forgeable that way.
    const other = start("__probe", { challenge: 18244, verify: 18245 });
    try {
      expect(await waitForBoard(18244)).toBe(true);
      await fetch(`http://127.0.0.1:${port}/api/probe`);
      await fetch("http://127.0.0.1:18244/api/probe");
      const mine = (await posture()).tokens.probe_called;
      const theirs = (
        (await (await fetch("http://127.0.0.1:18244/posture")).json()) as {
          tokens: Record<string, string>;
        }
      ).tokens.probe_called;
      // Same FLAG_SEED, same gate, different run: the receipts must differ.
      expect(mine).not.toBeNull();
      expect(theirs).not.toBe(mine as string);
    } finally {
      other.process.kill();
    }
  });
});

describe("an uncaught fault is visible, not just survived", () => {
  const port = 18252;
  const verifyPort = 18253;
  let app: Started;

  beforeAll(async () => {
    app = start("__probe", { challenge: port, verify: verifyPort });
    expect(await waitForBoard(port)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should report healthy before anything goes wrong", async () => {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(health.status).toBe(200);
    expect((await health.json()) as { faults: unknown[] }).toMatchObject({ ok: true, faults: [] });
  });

  it("should stay up but stop claiming to be well after a fault", async () => {
    // Staying up is right for a training container. Staying up while answering
    // "ok" is how an app hides that it is in a bad state.
    await fetch(`http://127.0.0.1:${port}/api/probe-fault`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(health.status).toBe(503);
    const body = (await health.json()) as { ok: boolean; faults: Array<{ kind: string }> };
    expect(body.ok).toBe(false);
    expect(body.faults.length).toBeGreaterThan(0);
    expect(body.faults[0]?.kind).toBe("unhandled rejection");

    // ...and it really is still serving, which is the point of surviving at all.
    expect((await fetch(`http://127.0.0.1:${port}/api/board`)).status).toBe(200);
  });

  it("should also put the fault in the log the participant reads", async () => {
    const logs = (await (await fetch(`http://127.0.0.1:${port}/api/logs?limit=200`)).json()) as {
      lines: Array<{ level: string; message: string }>;
    };
    expect(
      logs.lines.some(
        (line) => line.level === "error" && line.message.startsWith("unhandled rejection:"),
      ),
    ).toBe(true);
  });
});

describe("onboarding is unaffected by the new contract", () => {
  const port = 18246;
  const verifyPort = 18247;
  let app: Started;

  beforeAll(async () => {
    app = start("onboarding", { challenge: port, verify: verifyPort });
    expect(await waitForBoard(port)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should not grow a tokens field it never opted into", async () => {
    // Onboarding's answers are displayed on the board and in the log on purpose.
    // A per-gate receipt there would hand three of its four answers over at once.
    const posture = (await (await fetch(`http://127.0.0.1:${port}/posture`)).json()) as Record<
      string,
      unknown
    >;
    expect(posture).not.toHaveProperty("tokens");
    expect(posture).toHaveProperty("gates");
    expect(posture).toHaveProperty("readyToken");
  });
});

describe("a scenario cannot take over the board's own surface", () => {
  it("should refuse to boot when a scenario redeclares a base route", async () => {
    const app = start("__shadow", { challenge: 18248, verify: 18249 });
    const code = await Promise.race([
      app.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    app.process.kill();
    // Silently shadowing /healthz would be found by whoever debugged it next,
    // which is the wrong person at the wrong time.
    expect(code).toBe(1);
    expect(app.stderr()).toContain("redeclares the base route GET /healthz");
  });

  it("should refuse to boot on a scenario that does not exist", async () => {
    const app = start("__no_such_scenario", { challenge: 18250, verify: 18251 });
    const code = await Promise.race([
      app.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    app.process.kill();
    expect(code).toBe(1);
    expect(app.stderr()).toContain("unknown SCENARIO");
  });
});
