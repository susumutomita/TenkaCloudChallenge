import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-recover is graded almost entirely on *behaviour*: five gates, each
 * standing on the running app sending itself real HTTP requests, and five
 * submissions that are receipts the app emits only while the corresponding gate
 * is true.
 *
 * That makes two failure modes worth more than everything else, and most of this
 * file is about them:
 *
 *   1. A checkpoint that passes against an untouched starter, or against a stub
 *      that removed the feature instead of fixing it. Every absence assertion
 *      here is preceded by a positive one, and each pairing is tested from the
 *      side that would expose a missing precondition — the state where the
 *      absence holds and the feature is gone.
 *
 *   2. A checkpoint whose earned value is accepted in a state where it must not
 *      be. Guessing wrong proves only that guessing fails, so every checkpoint
 *      below is also driven with the real value, harvested from the real app, in
 *      a state that must refuse it.
 *
 * Everything runs under Bun against `stackstack-base/app/server.mjs` directly:
 * no Docker daemon and no AWS. Each instance gets its own scratch config,
 * policy and state directory, so the suite never edits the files the problem
 * ships.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-recover");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "recover.mjs");
const SEED = "stackstack-recover-test-seed";

/** Ports reserved for this problem's suite alone. */
const PORTS = {
  main: [18360, 18361],
  starter: [18362, 18363],
  boot: [18364, 18365],
  chain: [18366, 18367],
  seedDrift: [18368, 18369],
} as const;

const SHIPPED_TOKEN = "night-deploy-4f2a";

interface Metadata {
  readonly difficulty: number;
  readonly scoring: {
    readonly kind: string;
    readonly checks: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly points: number;
      readonly wrongAnswerPenalty?: number;
      readonly hints?: ReadonlyArray<{ readonly id: string; readonly penalty: number }>;
    }>;
  };
  readonly i18n: {
    readonly en: {
      readonly checks: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly hints?: ReadonlyArray<{ readonly id: string }>;
      }>;
    };
  };
  readonly exposedPorts: ReadonlyArray<{ readonly port: number; readonly name: string }>;
  readonly runtime: {
    readonly challengeEndpoints: Record<string, string>;
    readonly verifyUrl: string;
  };
}

const metadata = JSON.parse(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")) as Metadata;
const shippedPolicy = JSON.parse(
  readFileSync(join(PROBLEM_DIR, "local", "policy", "policy.json"), "utf8"),
) as {
  auth: { requireToken: boolean; token: string; protect: string[] };
  storage: { writable: string[] };
  digest: { enabled: boolean };
};

let scratch = "";

/** One running app, with its own files, driven exactly the way a participant drives it. */
class Instance {
  readonly board: string;
  readonly verify: string;
  readonly stateDir: string;
  readonly digestDir: string;
  readonly configPath: string;
  readonly policyPath: string;
  private readonly process: ReturnType<typeof spawn>;
  private output = "";

  constructor(
    name: string,
    [port, verifyPort]: readonly [number, number] | (readonly number[]),
    options: { readonly seed?: string; readonly policy?: unknown } = {},
  ) {
    const home = join(scratch, name);
    mkdirSync(home, { recursive: true });
    this.stateDir = join(home, "state");
    mkdirSync(this.stateDir, { recursive: true });
    this.digestDir = join(this.stateDir, "digest");
    this.configPath = join(home, "app.json");
    this.policyPath = join(home, "policy.json");
    writeFileSync(this.configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));
    writeFileSync(
      this.policyPath,
      options.policy === undefined
        ? readFileSync(join(PROBLEM_DIR, "local", "policy", "policy.json"), "utf8")
        : `${JSON.stringify(options.policy, null, 2)}\n`,
    );

    this.board = `http://127.0.0.1:${port}`;
    this.verify = `http://127.0.0.1:${verifyPort}/verify`;
    this.process = spawn("bun", [SERVER], {
      env: {
        ...process.env,
        SCENARIO: "recover",
        FLAG_SEED: options.seed ?? SEED,
        APP_CONFIG: this.configPath,
        RECOVER_POLICY: this.policyPath,
        RECOVER_STATE_DIR: this.stateDir,
        CHALLENGE_PORT: String(port),
        VERIFY_PORT: String(verifyPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.output += chunk.toString("utf8");
    });
  }

  stdout(): string {
    return this.output;
  }

  kill(): void {
    this.process.kill();
  }

  /** Wait for the listener, without touching any scenario surface. */
  async ready(): Promise<void> {
    const deadline = Date.now() + 8_000;
    for (;;) {
      try {
        if ((await fetch(`${this.verify.replace("/verify", "")}/healthz`)).ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error("the instance never started listening");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  /** Wait for the automatic boot probe to have latched the incident, from stdout alone. */
  async bootIncident(): Promise<void> {
    const deadline = Date.now() + 8_000;
    for (;;) {
      if (/incident opened id=inc-1 /.test(this.output)) return;
      if (Date.now() > deadline) throw new Error("the shipped state never reported an incident");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  writePolicy(policy: unknown): void {
    writeFileSync(this.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  }

  patchPolicy(patch: Record<string, unknown>): void {
    const current = JSON.parse(readFileSync(this.policyPath, "utf8")) as Record<string, unknown>;
    this.writePolicy({ ...current, ...patch });
  }

  writeConfig(patch: Record<string, unknown>): void {
    const current = JSON.parse(readFileSync(this.configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(this.configPath, JSON.stringify({ ...current, ...patch }, null, 2));
  }

  /** The policy a fully correct solve leaves behind, for this instance's paths. */
  fixedPolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      auth: { requireToken: true, token: SHIPPED_TOKEN, protect: ["/edge/posts"] },
      storage: { writable: [this.digestDir] },
      digest: { enabled: true },
      ...overrides,
    };
  }

  async get(path: string): Promise<{ status: number; body: any; text: string }> {
    const response = await fetch(`${this.board}${path}`);
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body, text };
  }

  async post(path: string, payload?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${this.board}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body: body as any };
  }

  /** Measure now — the same call a participant makes after saving an edit. */
  async probe(): Promise<any> {
    return (await this.post("/ops/probe")).body;
  }

  async status(): Promise<any> {
    return (await this.get("/ops/status")).body;
  }

  async posture(): Promise<{
    gates: Record<string, boolean>;
    tokens: Record<string, string | null>;
    ready: boolean;
    readyToken: string | null;
  }> {
    return (await this.get("/posture")).body;
  }

  async gates(): Promise<Record<string, boolean>> {
    return (await this.posture()).gates;
  }

  /** A gate's receipt, which `/posture` emits only while that gate is true. */
  async receipt(gate: string): Promise<string | null> {
    return (await this.posture()).tokens[gate] ?? null;
  }

  async signature(subsystems: readonly string[]): Promise<string> {
    const response = await this.get(`/ops/signature?subsystems=${subsystems.join(",")}`);
    return response.body.signature as string;
  }

  async answer(checkpointId: string, submission: string): Promise<boolean> {
    const response = await fetch(this.verify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId, submission, context: { teamId: "t" } }),
    });
    const body = (await response.json()) as { checkpointId: string; correct: boolean };
    expect(body.checkpointId).toBe(checkpointId);
    return body.correct;
  }

  /** Bring this instance to a fully solved state, restart included. */
  async solve(): Promise<void> {
    this.writePolicy(this.fixedPolicy());
    await this.post("/ops/digest/run");
    await this.probe();
    await this.post("/ops/restart");
  }
}

const instances: Instance[] = [];

function start(
  name: string,
  ports: readonly number[],
  options?: { readonly seed?: string; readonly policy?: unknown },
): Instance {
  const instance = new Instance(name, ports, options);
  instances.push(instance);
  return instance;
}

let main: Instance;
/** A second instance nobody fixes until late, kept module-wide so later tests can use it. */
let starter: Instance;
/** The same problem on a different `FLAG_SEED`, for everything that must not transfer. */
let other: Instance;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-recover-"));
  main = start("main", PORTS.main);
  starter = start("starter", PORTS.starter);
  other = start("seed-drift", PORTS.seedDrift, { seed: `${SEED}-other` });
  await Promise.all([main.ready(), starter.ready(), other.ready()]);
  await Promise.all([main.bootIncident(), starter.bootIncident()]);
});

afterAll(() => {
  for (const instance of instances) instance.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
    expect(metadata.scoring.kind).toBe("multi-verify");
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(200);
  });

  it("should spend the Medium tier's whole wrong-answer budget and no more", () => {
    // The tier standard is 5% of the base, and the validator only enforces that
    // for a flat `points`. Spread across checkpoints it still has to add to 10.
    const spent = metadata.scoring.checks.reduce(
      (sum, check) => sum + (check.wrongAnswerPenalty ?? 0),
      0,
    );
    expect(spent).toBe(10);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty ?? 0).toBeLessThanOrEqual(check.points);
    }
  });

  it("should keep every hint penalty within the per-checkpoint half", () => {
    for (const check of metadata.scoring.checks) {
      const spent = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(spent).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should keep the whole problem's hint budget under half the total", () => {
    const spent = metadata.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(spent).toBeLessThanOrEqual(100);
  });

  it("should open every checkpoint with a free hint and charge for the second", () => {
    // A free opening nudge that names only where to look, and a paid one that
    // names the edit: the costed trade-off SCORING.md exists to protect.
    for (const check of metadata.scoring.checks) {
      const hints = check.hints ?? [];
      expect(hints.length).toBe(2);
      expect(hints[0]?.penalty).toBe(0);
      expect(hints[1]?.penalty).toBeGreaterThan(0);
    }
  });

  it("should give every hint in the problem a unique id", () => {
    const ids = metadata.scoring.checks.flatMap((check) =>
      (check.hints ?? []).map((hint) => hint.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should mirror every checkpoint and hint in the English overlay", () => {
    expect(metadata.i18n.en.checks.map((check) => check.id)).toEqual(
      metadata.scoring.checks.map((check) => check.id),
    );
    for (const check of metadata.scoring.checks) {
      const english = metadata.i18n.en.checks.find((entry) => entry.id === check.id);
      expect((english?.hints ?? []).map((hint) => hint.id)).toEqual(
        (check.hints ?? []).map((hint) => hint.id),
      );
    }
  });

  it("should keep every participant-visible label free of an answer", () => {
    // Labels and hints are shown to the competitor. None of them may carry a
    // receipt, a signature, or the literal fix.
    const visible = [
      ...metadata.scoring.checks.map((check) => check.label),
      ...metadata.i18n.en.checks.map((check) => check.label),
    ].join("\n");
    expect(visible).not.toMatch(/TC\{/);
    expect(visible).not.toMatch(/[0-9a-f]{12}/);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover reproduces its own failure", () => {
  /**
   * A fresh instance nobody has touched. It must break by itself: the problem's
   * first 完了条件 is that the initial failure reproduces automatically, and a
   * failure that only appears once the participant pokes at something is a
   * failure the participant caused.
   */
  it("should latch an incident from the container's own stdout, with nothing requested", () => {
    // Asserted from stdout, not from a route: asking a route would itself be an
    // action, and this test is about the failure existing before any.
    expect(starter.stdout()).toMatch(/incident opened id=inc-1 down=/);
  });

  it("should stop exactly the four subsystems the shipped policy stops", async () => {
    const status = await starter.status();
    expect(status.subsystems).toEqual({
      "digest-job": "down",
      "edge-auth": "ok",
      "health-probe": "down",
      "policy-loader": "ok",
      "public-read": "down",
      "public-write": "down",
    });
  });

  it("should take the public entrance dark and drain the board behind it", async () => {
    const health = await starter.get("/edge/healthz");
    expect(health.status).toBe(401);
    expect(health.body.detail).toContain("auth.protect");
    const read = await starter.get("/edge/board");
    expect(read.status).toBe(503);
    expect(read.body.error).toBe("draining");
  });

  it("should keep every link on the ops console relative, so a forwarded origin works", async () => {
    // The console is reached through a forwarded port in Codespaces and through
    // loopback locally, and a hard-coded origin would work in exactly one.
    const page = await starter.get("/ops");
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("http://127.0.0.1");
    expect(page.text).not.toContain("http://localhost");
    // ...and it names the path the job actually writes, which is the path
    // `storage.writable` is compared against. Printing only the checkout-side
    // path would have the participant write a value that can never match.
    expect(page.text).toContain(join(starter.digestDir, "latest.json"));
  });

  it("should keep the ops plane answering while the entrance does not", async () => {
    // The whole problem is unplayable if the diagnostic surface goes with the
    // public one — and the oracle a checkpoint needs lives there.
    expect((await starter.get("/ops")).status).toBe(200);
    expect((await starter.status()).policy.ok).toBe(true);
    expect((await starter.get("/ops/signature?subsystems=digest-job")).status).toBe(200);
    expect((await starter.get("/api/logs")).status).toBe(200);
    expect((await starter.get("/posture")).status).toBe(200);
  });

  it("should keep the board's own origin healthy behind the dark entrance", async () => {
    // The board did not break. The entrance in front of it did, and telling
    // those apart is the first move.
    expect((await starter.get("/healthz")).status).toBe(200);
    expect((await starter.get("/api/board")).status).toBe(200);
  });

  it("should refuse the scheduled job's write and name the path and the setting", async () => {
    const digest = (await starter.get("/ops/digest")).body;
    expect(digest.lastRun.ok).toBe(false);
    expect(digest.lastRun.error).toContain("write_denied");
    expect(digest.lastRun.error).toContain("storage.writable");
    expect(existsSync(join(starter.digestDir, "latest.json"))).toBe(false);
  });

  it("should record every subsystem's observation for the incident it opened", async () => {
    const incident = (await starter.get("/ops/incident?id=inc-1")).body;
    expect(incident.observations).toHaveLength(6);
    expect(incident.closedAt).toBeNull();
    // The evidence names what stopped; turning that set into a value is the
    // oracle's job, and no surface here hands the value over.
    expect(JSON.stringify(incident)).not.toContain("signature");
  });

  it("should fail every checkpoint on an untouched starter, however it is answered", async () => {
    const guesses = [
      "",
      " ",
      "000000000000",
      "TC{auth_enforced_0000000000000000}",
      "TC{digest_ok_0000000000000000}",
      "TC{scope_narrow_0000000000000000}",
      "TC{survived_restart_0000000000000000}",
      "TC{ready_0000000000000000}",
    ];
    for (const check of metadata.scoring.checks) {
      for (const guess of guesses) {
        expect(await starter.answer(check.id, guess)).toBe(false);
      }
    }
    expect(await starter.gates()).toEqual({
      service_restored: false,
      auth_enforced: false,
      digest_ok: false,
      scope_narrow: false,
      survived_restart: false,
    });
  });

  it("should not be fixed by restarting the worker, and should say so in the ledger", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const restart = (await starter.post("/ops/restart")).body;
      expect(restart.restart.afterOk).toBe(false);
    }
    const status = await starter.status();
    expect(status.restarts).toHaveLength(3);
    expect(status.restarts.every((entry: { afterOk: boolean }) => entry.afterOk === false)).toBe(
      true,
    );
    expect(status.gates.survived_restart).toBe(false);
    expect(status.subsystems["health-probe"]).toBe("down");
  });

  it("should not clear the incident or its clock when the worker restarts", async () => {
    // A restart clears the subsystem counters, which is what a restart really
    // clears. Losing the incident would erase the evidence that a restart was
    // tried and did nothing.
    const status = await starter.status();
    expect(status.incident.first.id).toBe("inc-1");
    expect(status.incident.open).toBe("inc-1");
    expect(status.recovery.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover signature oracle", () => {
  const SUBSYSTEMS = [
    "digest-job",
    "edge-auth",
    "health-probe",
    "policy-loader",
    "public-read",
    "public-write",
  ];
  const ACTUAL = ["digest-job", "health-probe", "public-read", "public-write"];

  it("should be order- and duplicate-insensitive over a set", async () => {
    const canonical = await main.signature(ACTUAL);
    expect(canonical).toMatch(/^[0-9a-f]{12}$/);
    expect(await main.signature([...ACTUAL].reverse())).toBe(canonical);
    expect(await main.signature([...ACTUAL, "health-probe", "health-probe"])).toBe(canonical);
  });

  it("should give every one of the 63 non-empty subsets a value of its own", async () => {
    // A degenerate oracle that ignored its argument and returned a constant
    // would make the checkpoint a single free guess.
    const seen = new Map<string, string>();
    for (let mask = 1; mask < 1 << SUBSYSTEMS.length; mask += 1) {
      const set = SUBSYSTEMS.filter((_, index) => (mask & (1 << index)) !== 0);
      const value = await main.signature(set);
      expect(seen.has(value)).toBe(false);
      seen.set(value, set.join(","));
    }
    expect(seen.size).toBe(63);
  });

  it("should refuse a name it does not know, and say which names it takes", async () => {
    const response = await main.get("/ops/signature?subsystems=digest-job,everything");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_subsystem");
    expect(response.body.valid.sort()).toEqual([...SUBSYSTEMS].sort());
    expect((await main.get("/ops/signature?subsystems=")).status).toBe(400);
  });

  it("should give two deploys different values for the same set", async () => {
    // The answer is derived from FLAG_SEED inside the container, so a table of
    // answers harvested from one deploy is worth nothing against the next.
    expect(await other.signature(ACTUAL)).not.toBe(await main.signature(ACTUAL));
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover gates rise one at a time", () => {
  /**
   * Every gate driven to true while at least one other stays false.
   *
   * A gate implied by another cannot be raised on its own here, and a sign-off
   * nobody can decompose is a sign-off nobody can trust. It also catches the
   * cheapest possible regression — a gate hardcoded `true` — which a suite that
   * only ever watches gates go green together would miss entirely.
   */
  let instance: Instance;

  beforeAll(async () => {
    instance = start("chain", PORTS.chain);
    await instance.ready();
    await instance.bootIncident();
  });

  it("should hold auth enforced while the entrance is still dark", async () => {
    // Covering the read path but not the health path: the watchdog is happy, so
    // nothing drains, but the public read is refused. Authentication is doing
    // its job and the service is still down — two separate facts.
    instance.writePolicy(
      instance.fixedPolicy({
        auth: { requireToken: true, token: SHIPPED_TOKEN, protect: ["/edge/board", "/edge/posts"] },
      }),
    );
    await instance.post("/ops/digest/run");
    await instance.probe();
    const gates = await instance.gates();
    expect(gates.auth_enforced).toBe(true);
    expect(gates.service_restored).toBe(false);
  });

  it("should refuse the board checkpoint on its own receipt while the entrance is dark", async () => {
    // The receipt is real and freshly emitted by the app: the checkpoint has to
    // refuse it because the *other* half of what it measures is false, not
    // because the value is wrong.
    const receipt = await instance.receipt("auth_enforced");
    expect(receipt).toMatch(/^TC\{auth_enforced_[0-9a-f]{16}\}$/);
    expect(await instance.answer("board-back", receipt as string)).toBe(false);
  });

  it("should hold the write scope narrow while nothing is being written", async () => {
    // The width assertion on its own is satisfied by an app that writes
    // nothing. This is the state that proves the checkpoint's precondition is
    // load-bearing rather than decorative.
    instance.writePolicy(instance.fixedPolicy({ digest: { enabled: false } }));
    await instance.post("/ops/digest/run");
    await instance.probe();
    const gates = await instance.gates();
    expect(gates.scope_narrow).toBe(true);
    expect(gates.digest_ok).toBe(false);
  });

  it("should refuse the scope checkpoint on its own receipt while the job is switched off", async () => {
    const receipt = await instance.receipt("scope_narrow");
    expect(receipt).toMatch(/^TC\{scope_narrow_[0-9a-f]{16}\}$/);
    expect(await instance.answer("least-privilege-held", receipt as string)).toBe(false);
  });

  it("should run the job while the entrance is still dark", async () => {
    instance.writePolicy(
      instance.fixedPolicy({
        auth: { requireToken: true, token: SHIPPED_TOKEN, protect: ["/edge/board", "/edge/posts"] },
      }),
    );
    await instance.post("/ops/digest/run");
    await instance.probe();
    const gates = await instance.gates();
    expect(gates.digest_ok).toBe(true);
    expect(gates.service_restored).toBe(false);
    expect(gates.survived_restart).toBe(false);
  });

  it("should reach four gates on the fix, and the fifth only after a restart", async () => {
    instance.writePolicy(instance.fixedPolicy());
    await instance.post("/ops/digest/run");
    await instance.probe();
    expect(await instance.gates()).toEqual({
      service_restored: true,
      auth_enforced: true,
      digest_ok: true,
      scope_narrow: true,
      survived_restart: false,
    });

    const restart = (await instance.post("/ops/restart")).body;
    expect(restart.restart.afterOk).toBe(true);
    expect(await instance.gates()).toEqual({
      service_restored: true,
      auth_enforced: true,
      digest_ok: true,
      scope_narrow: true,
      survived_restart: true,
    });
  });

  it("should close the incident once nothing is down, and report the clock as feedback", async () => {
    const status = await instance.status();
    expect(status.incident.open).toBeNull();
    expect(status.incident.first.closedAt).not.toBeNull();
    expect(status.recovery.recoveredAfterSeconds).toBeGreaterThanOrEqual(0);
    expect(status.recovery.budgetSeconds).toBeGreaterThan(0);
  });

  it("should open a second incident when something breaks again, and keep the first answer", async () => {
    // The GameDay Incident phase replays this scenario inside an event that
    // breaks the same subsystems more than once, so the latch has to re-arm —
    // and the first incident's answer has to survive the second one.
    const first = await instance.signature([
      "digest-job",
      "health-probe",
      "public-read",
      "public-write",
    ]);
    expect(await instance.answer("incident-scope", first)).toBe(true);

    instance.writePolicy(instance.fixedPolicy({ digest: { enabled: false } }));
    await instance.post("/ops/digest/run");
    await instance.probe();
    const status = await instance.status();
    expect(status.incident.count).toBe(2);
    expect(status.incident.open).toBe("inc-2");
    expect(status.incident.first.id).toBe("inc-1");

    // The second incident's signature is a real value this app just produced,
    // for a set that really is down — and it is not the answer to a checkpoint
    // that asks about the first one.
    const second = await instance.signature(["digest-job"]);
    expect(second).not.toBe(first);
    expect(await instance.answer("incident-scope", second)).toBe(false);
    expect(await instance.answer("incident-scope", first)).toBe(true);

    instance.writePolicy(instance.fixedPolicy());
    await instance.post("/ops/digest/run");
    await instance.post("/ops/restart");
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover checkpoints on a solved instance", () => {
  beforeAll(async () => {
    await main.solve();
  });

  it("should pass all five once the fix is in and a restart has been ridden out", async () => {
    const posture = await main.posture();
    expect(posture.gates).toEqual({
      service_restored: true,
      auth_enforced: true,
      digest_ok: true,
      scope_narrow: true,
      survived_restart: true,
    });
    expect(
      await main.answer(
        "incident-scope",
        await main.signature(["digest-job", "health-probe", "public-read", "public-write"]),
      ),
    ).toBe(true);
    expect(await main.answer("board-back", posture.tokens.auth_enforced as string)).toBe(true);
    expect(await main.answer("job-restored", posture.tokens.digest_ok as string)).toBe(true);
    expect(
      await main.answer("least-privilege-held", posture.tokens.scope_narrow as string),
    ).toBe(true);
    expect(
      await main.answer("no-recurrence", posture.tokens.survived_restart as string),
    ).toBe(true);
  });

  it("should have written the scheduled job's output where the participant can read it", async () => {
    const file = join(main.digestDir, "latest.json");
    expect(existsSync(file)).toBe(true);
    const output = JSON.parse(readFileSync(file, "utf8")) as { revision: string };
    expect(output.revision).toBe((await main.status()).policy.revision);
    // The submission is not in the file: a hand-written file cannot answer this.
    expect(readFileSync(file, "utf8")).not.toContain("TC{");
  });

  it("should reject an empty, truncated or extended submission on every checkpoint", async () => {
    // Guards against a handler loosened to a substring or truthiness test: with
    // `includes` in place of an equality check, "" matches everything.
    const posture = await main.posture();
    const answers: Record<string, string> = {
      "incident-scope": await main.signature([
        "digest-job",
        "health-probe",
        "public-read",
        "public-write",
      ]),
      "board-back": posture.tokens.auth_enforced as string,
      "job-restored": posture.tokens.digest_ok as string,
      "least-privilege-held": posture.tokens.scope_narrow as string,
      "no-recurrence": posture.tokens.survived_restart as string,
    };
    for (const check of metadata.scoring.checks) {
      const right = answers[check.id] as string;
      expect(await main.answer(check.id, "")).toBe(false);
      expect(await main.answer(check.id, " ")).toBe(false);
      expect(await main.answer(check.id, right.slice(0, -1))).toBe(false);
      expect(await main.answer(check.id, `${right}x`)).toBe(false);
      // ...and the real answer still passes, so the assertions above are not
      // passing merely because the checkpoint refuses everything.
      expect(await main.answer(check.id, ` ${right} `)).toBe(true);
    }
  });

  it("should never accept one checkpoint's earned receipt at another checkpoint", async () => {
    // Every value below was really emitted by this app for a gate that is
    // really true. None of them is the answer to any other checkpoint, and a
    // handler that compared against "some receipt" rather than its own would
    // pass this suite otherwise.
    const posture = await main.posture();
    const owned: Record<string, string> = {
      "board-back": posture.tokens.auth_enforced as string,
      "job-restored": posture.tokens.digest_ok as string,
      "least-privilege-held": posture.tokens.scope_narrow as string,
      "no-recurrence": posture.tokens.survived_restart as string,
    };
    const spare = posture.tokens.service_restored as string;
    expect(spare).toMatch(/^TC\{service_restored_/);
    for (const [checkpoint, receipt] of Object.entries(owned)) {
      for (const [otherCheckpoint, otherReceipt] of Object.entries(owned)) {
        if (checkpoint === otherCheckpoint) continue;
        expect(await main.answer(checkpoint, otherReceipt)).toBe(false);
      }
      // A receipt no checkpoint owns must not open one either.
      expect(await main.answer(checkpoint, spare)).toBe(false);
      expect(await main.answer(checkpoint, receipt)).toBe(true);
    }
  });

  it("should not accept the board's own sign-off token anywhere", async () => {
    // `readyToken` is derived from FLAG_SEED and is byte-identical to the token
    // stackstack-onboarding's last checkpoint accepts. A participant who solved
    // onboarding with the same seed must not be able to paste it in here.
    const posture = await main.posture();
    const readyToken = posture.readyToken;
    expect(readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
    for (const check of metadata.scoring.checks) {
      expect(await main.answer(check.id, readyToken as string)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover refuses a receipt the moment it stops being true", () => {
  /**
   * Rule 3, one checkpoint at a time: the value is harvested from the running
   * app in a state where it is legitimately emitted, then the state is broken
   * and the *same* value resubmitted. A handler that remembered a pass, or that
   * stamped the receipt onto its failure path, survives every other test in
   * this file and dies here.
   */
  it("should stop accepting the board receipt once the auth rule is taken back out", async () => {
    const receipt = (await main.posture()).tokens.auth_enforced as string;
    expect(await main.answer("board-back", receipt)).toBe(true);

    main.patchPolicy({ auth: { requireToken: false, token: SHIPPED_TOKEN, protect: [] } });
    await main.probe();
    expect(await main.answer("board-back", receipt)).toBe(false);
    // ...and the measurement says why: an anonymous write now goes through.
    const status = await main.status();
    expect(status.probe.anonymousWrite).toBe(201);
    expect(status.subsystems["edge-auth"]).toBe("down");

    main.writePolicy(main.fixedPolicy());
    await main.post("/ops/digest/run");
    await main.probe();
    expect(await main.answer("board-back", receipt)).toBe(true);
  });

  it("should stop accepting the board receipt once the board stops accepting writes", async () => {
    // Closing the board is the "block everything and nothing bad can happen"
    // shortcut. The authorised write returns 409 instead of 201, so the
    // positive half of the measurement fails before the refusal half is read.
    const receipt = (await main.posture()).tokens.auth_enforced as string;
    main.writeConfig({ acceptingPosts: false });
    await main.probe();
    expect((await main.status()).probe.authorisedWrite).toBe(409);
    expect(await main.answer("board-back", receipt)).toBe(false);

    main.writeConfig({ acceptingPosts: true });
    await main.probe();
    expect(await main.answer("board-back", receipt)).toBe(true);
  });

  it("should stop accepting the job receipt once the job is switched off", async () => {
    const receipt = (await main.posture()).tokens.digest_ok as string;
    expect(await main.answer("job-restored", receipt)).toBe(true);

    main.patchPolicy({ digest: { enabled: false } });
    expect(await main.answer("job-restored", receipt)).toBe(false);

    main.writePolicy(main.fixedPolicy());
    expect(await main.answer("job-restored", receipt)).toBe(true);
  });

  it("should stop accepting the scope receipt once the allow-list is widened", async () => {
    const receipt = (await main.posture()).tokens.scope_narrow as string;
    expect(await main.answer("least-privilege-held", receipt)).toBe(true);

    main.patchPolicy({ storage: { writable: [main.stateDir] } });
    // The job still succeeds — widening does not break it, which is exactly why
    // this needs a width assertion rather than a working-job assertion.
    expect((await main.post("/ops/digest/run")).body.lastRun.ok).toBe(true);
    expect((await main.status()).storage.forbiddenPathsAdmitted).toBeGreaterThan(0);
    expect(await main.answer("least-privilege-held", receipt)).toBe(false);

    main.writePolicy(main.fixedPolicy());
    expect(await main.answer("least-privilege-held", receipt)).toBe(true);
  });

  it("should stop accepting the stability receipt as soon as the policy changes again", async () => {
    const receipt = (await main.posture()).tokens.survived_restart as string;
    expect(await main.answer("no-recurrence", receipt)).toBe(true);

    // A semantically different policy: still correct, still solved, but this
    // exact revision has never survived a restart, so the claim is not yet true.
    main.writePolicy(
      main.fixedPolicy({
        auth: { requireToken: true, token: `${SHIPPED_TOKEN}-rotated`, protect: ["/edge/posts"] },
      }),
    );
    await main.post("/ops/digest/run");
    await main.probe();
    expect((await main.gates()).survived_restart).toBe(false);
    expect(await main.answer("no-recurrence", receipt)).toBe(false);

    await main.post("/ops/restart");
    expect((await main.gates()).survived_restart).toBe(true);
    expect(await main.answer("no-recurrence", receipt)).toBe(true);
  });

  it("should not count a restart taken before the fix", async () => {
    // The instance that spent three restarts on the broken policy, now fixed
    // without a further restart: the earlier entries carry a different revision
    // and cannot be borrowed.
    expect((await starter.status()).restarts.length).toBeGreaterThan(0);
    starter.writePolicy(starter.fixedPolicy());
    await starter.post("/ops/digest/run");
    await starter.probe();
    const gates = await starter.gates();
    expect(gates.service_restored).toBe(true);
    expect(gates.auth_enforced).toBe(true);
    expect(gates.digest_ok).toBe(true);
    expect(gates.scope_narrow).toBe(true);
    expect(gates.survived_restart).toBe(false);
    expect(await starter.receipt("survived_restart")).toBeNull();
    expect(await starter.answer("no-recurrence", "TC{survived_restart_0000000000000000}")).toBe(
      false,
    );

    await starter.post("/ops/restart");
    expect((await starter.gates()).survived_restart).toBe(true);
    expect(
      await starter.answer("no-recurrence", (await starter.receipt("survived_restart")) as string),
    ).toBe(true);
  });

  it("should require another restart after going back to an earlier policy", async () => {
    // A -> B -> back to A. There is a ledger entry at A that came back healthy,
    // but the worker running right now was last started under B, so "it stays
    // fixed across a restart" is not yet a fact about this process. Without the
    // last-entry clause the checkpoint would credit a restart the participant
    // has since undone.
    const policyA = starter.fixedPolicy();
    const policyB = starter.fixedPolicy({
      auth: { requireToken: true, token: `${SHIPPED_TOKEN}-b`, protect: ["/edge/posts"] },
    });
    starter.writePolicy(policyA);
    await starter.post("/ops/digest/run");
    await starter.post("/ops/restart");
    expect((await starter.gates()).survived_restart).toBe(true);
    const receiptAtA = (await starter.receipt("survived_restart")) as string;

    starter.writePolicy(policyB);
    await starter.post("/ops/digest/run");
    await starter.post("/ops/restart");
    expect((await starter.gates()).survived_restart).toBe(true);

    starter.writePolicy(policyA);
    await starter.post("/ops/digest/run");
    await starter.probe();
    expect((await starter.gates()).survived_restart).toBe(false);
    expect(await starter.answer("no-recurrence", receiptAtA)).toBe(false);

    await starter.post("/ops/restart");
    expect((await starter.gates()).survived_restart).toBe(true);
    expect(await starter.answer("no-recurrence", receiptAtA)).toBe(true);
  });

  it("should not rotate the revision when the same policy is merely reformatted", async () => {
    // Hashing the file's bytes would let an editor's format-on-save invalidate
    // a restart the participant already rode out, with nothing anywhere saying
    // why. Only a real setting change may rotate the revision — which means the
    // *order* of a list is not a setting change either, since `protect` and
    // `writable` are sets in everything that reads them.
    main.writePolicy(
      main.fixedPolicy({
        auth: {
          requireToken: true,
          token: SHIPPED_TOKEN,
          protect: ["/edge/posts", "/edge/nothing-here"],
        },
        storage: { writable: [main.digestDir, "/app/unused"] },
      }),
    );
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
    expect((await main.gates()).survived_restart).toBe(true);
    const before = (await main.status()).policy.revision;

    const parsed = JSON.parse(readFileSync(main.policyPath, "utf8")) as {
      auth: { requireToken: boolean; token: string; protect: string[] };
      storage: { writable: string[] };
      digest: { enabled: boolean };
    };
    // Same settings. Different section order, different key order inside a
    // section, reversed list order, different indentation, a trailing newline.
    writeFileSync(
      main.policyPath,
      `${JSON.stringify(
        {
          digest: parsed.digest,
          storage: { writable: [...parsed.storage.writable].reverse() },
          auth: {
            protect: [...parsed.auth.protect].reverse(),
            token: parsed.auth.token,
            requireToken: parsed.auth.requireToken,
          },
        },
        null,
        8,
      )}\n\n`,
    );
    expect((await main.status()).policy.revision).toBe(before);
    expect((await main.gates()).survived_restart).toBe(true);
  });

  it("should refuse to report a measurement taken under a policy that has changed", async () => {
    // `/posture` cannot probe — it is one of the board's own routes — so it has
    // to say what it knows, and what it knows about the previous policy is not
    // knowledge about this one. Reporting the old measurement as current is the
    // oldest lie in operations, and it would let a participant break something
    // and still show green until somebody happened to look.
    main.writePolicy(main.fixedPolicy());
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
    expect(await main.gates()).toMatchObject({ service_restored: true, auth_enforced: true });

    // Edited, and deliberately NOT re-measured.
    main.patchPolicy({ auth: { requireToken: true, token: SHIPPED_TOKEN, protect: ["/"] } });
    const stale = await main.gates();
    expect(stale.service_restored).toBe(false);
    expect(stale.auth_enforced).toBe(false);
    expect(await main.receipt("auth_enforced")).toBeNull();

    main.writePolicy(main.fixedPolicy());
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
  });

  it("should not call the job healthy when a real token has been swapped for a placeholder", async () => {
    // Behaviourally this state looks fine: the anonymous write is refused and
    // the authorised one goes through, because the probe presents whatever the
    // policy says. Weakening the credential to a placeholder is still undoing
    // last night's work, so the receipt has to stop.
    const receipt = (await main.posture()).tokens.auth_enforced as string;
    main.patchPolicy({ auth: { requireToken: true, token: "change-me", protect: ["/edge/posts"] } });
    await main.probe();
    const status = await main.status();
    expect(status.probe.anonymousWrite).toBe(401);
    expect(status.probe.authorisedWrite).toBe(201);
    expect(status.policy.auth.tokenLooksReal).toBe(false);
    expect(status.gates.auth_enforced).toBe(false);
    expect(await main.answer("board-back", receipt)).toBe(false);

    main.patchPolicy({ auth: { requireToken: true, token: "short", protect: ["/edge/posts"] } });
    await main.probe();
    expect((await main.gates()).auth_enforced).toBe(false);

    main.writePolicy(main.fixedPolicy());
    await main.probe();
    expect(await main.answer("board-back", receipt)).toBe(true);
  });

  it("should not call the job healthy when its output is gone or belongs to an older policy", async () => {
    // The in-memory record of a successful run is not the work. A job that
    // reported success and left nothing behind is the exact failure this
    // checkpoint exists to notice, so the file is re-read off disk every time.
    await main.post("/ops/digest/run");
    expect((await main.gates()).digest_ok).toBe(true);
    const file = join(main.digestDir, "latest.json");
    const good = readFileSync(file, "utf8");

    rmSync(file);
    expect((await main.gates()).digest_ok).toBe(false);

    // Present, parseable, and from a policy that is no longer in force.
    writeFileSync(file, JSON.stringify({ generatedAt: "2026-04-08T00:00:00.000Z", revision: "0123456789ab" }));
    expect((await main.gates()).digest_ok).toBe(false);
    expect(await main.answer("job-restored", "TC{digest_ok_0000000000000000}")).toBe(false);

    writeFileSync(file, good);
    expect((await main.gates()).digest_ok).toBe(true);
    expect(
      await main.answer("job-restored", (await main.receipt("digest_ok")) as string),
    ).toBe(true);
  });

  it("should refuse the stability checkpoint while the write permission is too wide", async () => {
    // Everything is up, the job runs, and a restart under this exact policy came
    // back healthy — so `survived_restart` really is true and its receipt really
    // is emitted. It is still not a state anybody should sign off on, and the
    // final checkpoint is the conjunction rather than the last gate.
    main.writePolicy(main.fixedPolicy({ storage: { writable: [main.stateDir] } }));
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
    const gates = await main.gates();
    expect(gates.survived_restart).toBe(true);
    expect(gates.digest_ok).toBe(true);
    expect(gates.scope_narrow).toBe(false);

    const receipt = (await main.receipt("survived_restart")) as string;
    expect(receipt).toMatch(/^TC\{survived_restart_/);
    expect(await main.answer("no-recurrence", receipt)).toBe(false);

    main.writePolicy(main.fixedPolicy());
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
    expect(
      await main.answer("no-recurrence", (await main.receipt("survived_restart")) as string),
    ).toBe(true);
  });

  it("should not let an allow-list written against one deploy pass on the next", async () => {
    // A single prefix entry may name an exact file, so an allow-list that
    // enumerated the forbidden paths would satisfy the width assertion while
    // permitting every one of them. Three of the four are named from FLAG_SEED
    // for exactly that reason, and the only way to show it is to build the
    // entry the way the container does and watch it stop working next door.
    const canaryName = (seed: string) =>
      createHash("sha256")
        .update(`recover:canary-quarantine:${seed}`)
        .digest("hex")
        .slice(0, 8);

    // On the instance it was derived for, naming it is a permission grant.
    main.writePolicy(
      main.fixedPolicy({
        storage: {
          writable: [main.digestDir, join(main.stateDir, "quarantine", `${canaryName(SEED)}.bin`)],
        },
      }),
    );
    await main.post("/ops/digest/run");
    await main.probe();
    expect((await main.status()).storage.forbiddenPathsAdmitted).toBe(1);
    expect((await main.gates()).scope_narrow).toBe(false);

    // The same entry, carried to a deploy with a different seed, permits
    // nothing: that deploy's forbidden paths are named from its own seed.
    other.writePolicy(
      other.fixedPolicy({
        storage: {
          writable: [other.digestDir, join(other.stateDir, "quarantine", `${canaryName(SEED)}.bin`)],
        },
      }),
    );
    await other.post("/ops/digest/run");
    await other.probe();
    expect((await other.status()).storage.forbiddenPathsAdmitted).toBe(0);
    expect((await other.gates()).scope_narrow).toBe(true);

    main.writePolicy(main.fixedPolicy());
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover write-scope width", () => {
  /**
   * The one absence assertion in this problem, driven from both sides. Its
   * precondition — the job demonstrably writing — is covered above; here the
   * question is whether the width test itself discriminates.
   */
  const instance = () => main;

  const widths: ReadonlyArray<readonly [string, (i: Instance) => string[], boolean]> = [
    ["the output directory itself", (i) => [i.digestDir], true],
    ["the output directory with a trailing slash", (i) => [`${i.digestDir}/`], true],
    ["everything", () => ["/"], false],
    ["the state directory", (i) => [i.stateDir], false],
    ["the state directory's parent", (i) => [join(i.stateDir, "..")], false],
    [
      "the output directory plus the quarantine directory",
      (i) => [i.digestDir, join(i.stateDir, "quarantine")],
      false,
    ],
    ["the output directory plus the config directory", (i) => [i.digestDir, "/app/config"], false],
  ];

  for (const [name, writable, narrow] of widths) {
    it(`should ${narrow ? "accept" : "reject"} an allow-list of ${name}`, async () => {
      instance().writePolicy(instance().fixedPolicy({ storage: { writable: writable(instance()) } }));
      await instance().post("/ops/digest/run");
      await instance().probe();
      expect((await instance().gates()).scope_narrow).toBe(narrow);
    });
  }

  it("should not be fooled by a prefix that only looks like it contains the target", async () => {
    // `<digest>/../escape.txt` sits beside the digest directory, not inside it.
    // A prefix test that compared before normalising would admit it.
    instance().writePolicy(instance().fixedPolicy());
    await instance().post("/ops/digest/run");
    await instance().probe();
    const status = await instance().status();
    expect(status.storage.admitsDigestDirectory).toBe(true);
    expect(status.storage.forbiddenPathsAdmitted).toBe(0);
    expect(status.storage.forbiddenPathsChecked).toBe(4);
    // The forbidden paths themselves are never published: a list to route
    // around is not a width assertion.
    expect(JSON.stringify(status)).not.toContain("escape.txt");
    expect(JSON.stringify(status)).not.toContain("credentials.json");
  });

  it("should restore the solved state for the tests that follow", async () => {
    await instance().post("/ops/restart");
    expect((await instance().gates()).survived_restart).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover refuses a policy it cannot read", () => {
  it("should report an unknown setting rather than quietly ignoring it", async () => {
    main.patchPolicy({ authz: { requireToken: true } });
    const status = await main.status();
    expect(status.policy.ok).toBe(false);
    expect(status.policy.error).toContain("authz");
    expect(status.subsystems["policy-loader"]).toBe("down");
    expect(status.gates.auth_enforced).toBe(false);
  });

  it("should report a broken policy file rather than falling back to something permissive", async () => {
    writeFileSync(main.policyPath, "{ this is not json");
    const status = await main.status();
    expect(status.policy.ok).toBe(false);
    expect(status.policy.error).toContain("not valid JSON");
    // Falling back to "no auth required" while the file is broken would hand a
    // participant a green gate for a policy nobody can read.
    expect(status.gates.auth_enforced).toBe(false);
    const logs = await main.get("/api/logs?limit=200");
    expect(
      logs.body.lines.some((line: { message: string }) => line.message.startsWith("policy error:")),
    ).toBe(true);
  });

  it("should recover as soon as the file parses again", async () => {
    main.writePolicy(main.fixedPolicy());
    await main.post("/ops/digest/run");
    await main.probe();
    await main.post("/ops/restart");
    expect((await main.status()).policy.ok).toBe(true);
    expect((await main.gates()).survived_restart).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover probes are non-destructive", () => {
  it("should leave the board's own posts alone however often it measures", async () => {
    // The probe writes twice per cycle. If those landed on the board, the two
    // seeded story posts and every post the participant wrote would be evicted
    // out of the board's bounded ring within minutes.
    await main.post("/api/posts", { author: "you", title: "still here", body: "" });
    const before = (await main.get("/api/board")).body.posts.length;
    for (let cycle = 0; cycle < 30; cycle += 1) await main.probe();
    const board = (await main.get("/api/board")).body;
    expect(board.posts.length).toBe(before);
    expect(board.posts.filter((post: { seeded: boolean }) => post.seeded)).toHaveLength(2);
    expect(
      board.posts.some((post: { title: string }) => post.title === "still here"),
    ).toBe(true);
    expect(
      board.posts.some((post: { author: string }) => post.author.startsWith("probe-")),
    ).toBe(false);
  });

  it("should not disturb a participant's own configuration or policy files", async () => {
    const policy = readFileSync(main.policyPath, "utf8");
    const config = readFileSync(main.configPath, "utf8");
    for (const check of metadata.scoring.checks) await main.answer(check.id, "nonsense");
    expect(readFileSync(main.policyPath, "utf8")).toBe(policy);
    expect(readFileSync(main.configPath, "utf8")).toBe(config);
  });

  it("should let a participant's own write reach the board through the entrance", async () => {
    // A probe write goes to the probe ledger; a real one has to reach the real
    // board, or the entrance would be measuring a path nobody uses.
    const created = await main.post(
      "/edge/posts",
      { author: "you", title: "through the entrance", body: "" },
      { authorization: `Bearer ${SHIPPED_TOKEN}` },
    );
    expect(created.status).toBe(201);
    expect(created.body.store).toBe("board");
    const board = (await main.get("/api/board")).body;
    expect(
      board.posts.some((post: { title: string }) => post.title === "through the entrance"),
    ).toBe(true);
  });

  it("should refuse an anonymous write through the entrance and name the setting", async () => {
    const refused = await main.post("/edge/posts", {
      author: "anyone",
      title: "no token",
      body: "",
    });
    expect(refused.status).toBe(401);
    expect(refused.body.detail).toContain("auth.protect");
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover /verify contract", () => {
  it("should echo the checkpoint id for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await fetch(main.verify, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: check.id, submission: "" }),
      });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { checkpointId: string }).checkpointId).toBe(check.id);
    }
    // The other direction too: a handler with no checkpoint behind it is dead
    // code nothing can reach, and a sign the two drifted apart.
    const scenario = readFileSync(SCENARIO_FILE, "utf8");
    const body = scenario.slice(scenario.indexOf("export const checks = {"));
    const handlers = [...body.matchAll(/^ {2}"([a-z][a-z0-9-]*)":\s*(?:\(|async)/gm)].map(
      (match) => match[1] as string,
    );
    expect(handlers.sort()).toEqual(metadata.scoring.checks.map((check) => check.id).sort());
  });

  it("should fail closed on a checkpoint id it does not know", async () => {
    const response = await fetch(main.verify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId: "no-such-checkpoint", submission: "x" }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("unknown_checkpoint");
  });

  it("should fail closed on an inherited property name, not call it", async () => {
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await fetch(main.verify, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: inherited, submission: "x" }),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("unknown_checkpoint");
    }
  });

  it("should survive a request target it cannot even parse", async () => {
    // `GET //` is a protocol-relative reference with no host, which `new URL`
    // rejects. Both servers share one process, so an unhandled throw here would
    // take the board and /verify down together and end the session — over a
    // typo. Sent raw, because fetch() would normalise the path away.
    await new Promise<void>((resolve) => {
      const socket = connect(PORTS.main[0], "127.0.0.1", () => {
        socket.write("GET // HTTP/1.1\r\nHost: board.local\r\nConnection: close\r\n\r\n");
      });
      socket.on("close", () => resolve());
      socket.on("error", () => resolve());
      socket.setTimeout(3000, () => {
        socket.destroy();
        resolve();
      });
    });
    expect((await main.get("/healthz")).status).toBe(200);
    expect((await main.get("/ops/status")).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${PORTS.main[1]}/healthz`)).ok).toBe(true);
  });

  it("should stay well after everything this suite has thrown at it", async () => {
    // `/healthz` answers 503 while any uncaught fault is outstanding. A timer,
    // a probe or a nested fetch that threw somewhere nobody was catching would
    // show up here rather than being silently survived.
    const health = await main.get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body.faults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-recover wiring", () => {
  const composeDir = join(PROBLEM_DIR, "local");
  const compose = parseYaml(readFileSync(join(composeDir, "docker-compose.yml"), "utf8")) as {
    services: Record<
      string,
      {
        build: { context: string; dockerfile: string };
        environment: Record<string, string>;
        volumes: string[];
        ports: string[];
        healthcheck: { test: string[] };
      }
    >;
  };
  const service = Object.values(compose.services)[0] as (typeof compose.services)[string];

  it("should publish every declared endpoint's port, on loopback only", () => {
    for (const url of Object.values(metadata.runtime.challengeEndpoints)) {
      expect(service.ports).toContain(`127.0.0.1:${new URL(url).port}:8080`);
    }
    expect(service.ports).toContain(`127.0.0.1:${new URL(metadata.runtime.verifyUrl).port}:8081`);
    for (const published of service.ports) expect(published.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should declare exactly the ports it publishes", () => {
    const published = service.ports
      .map((entry) => Number(entry.split(":")[1]))
      .sort((a, b) => a - b);
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    expect(existsSync(join(composeDir, service.build.context, service.build.dockerfile))).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("recover");
    expect(existsSync(SCENARIO_FILE)).toBe(true);
  });

  it("should point the container healthcheck at a surface this problem never takes dark", () => {
    // The public entrance 401s everything in the shipped state on purpose. A
    // liveness check aimed there would never report healthy, `docker compose up
    // --wait` would time out, and the participant would never reach the board
    // at all — the problem would look like a broken image rather than a broken
    // deploy.
    const test = service.healthcheck.test.join(" ");
    expect(test).toContain("http://127.0.0.1:8080/healthz");
    expect(test).not.toContain("/edge/");
  });

  it("should mount the two read-only inputs and the one writable output", () => {
    expect(service.volumes).toEqual([
      "./config:/app/config:ro",
      "./policy:/app/policy:ro",
      "./state:/app/state",
    ]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "policy", "policy.json"))).toBe(true);
    // Present so the bind mount does not create it as root, and ignoring its
    // own contents so a play session cannot leave the submodule dirty.
    expect(existsSync(join(composeDir, "state", ".gitignore"))).toBe(true);
    expect(readFileSync(join(composeDir, "state", ".gitignore"), "utf8")).toContain("*");
  });

  it("should name every participant-facing path as the participant sees it", () => {
    const paths = {
      CONFIG_HINT: "challenges/stackstack-recover/local/config/app.json",
      RECOVER_POLICY_HINT: "challenges/stackstack-recover/local/policy/policy.json",
      RECOVER_STATE_HINT: "challenges/stackstack-recover/local/state",
    } as const;
    for (const [variable, inThisRepo] of Object.entries(paths)) {
      // A participant runs `make local` from the TenkaCloud repository, where
      // this catalog is the `problems/` submodule.
      expect(service.environment[variable]).toBe(`problems/${inThisRepo}`);
      expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
    }
    const policyHint = service.environment.RECOVER_POLICY_HINT as string;
    for (const name of ["README.md", "README.ja.md"]) {
      expect(readFileSync(join(PROBLEM_DIR, name), "utf8")).toContain(policyHint);
    }
    expect(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")).toContain(policyHint);
  });

  it("should ship a policy that is broken in exactly the two places the problem is about", () => {
    // Both failures, and nothing else: the board is open for posts and the
    // token is a real one, so neither `acceptingPosts` nor a blank token is a
    // silent third cause nothing in the problem ever mentions.
    expect(shippedPolicy.auth.requireToken).toBe(true);
    expect(shippedPolicy.auth.protect).toEqual(["/"]);
    expect(shippedPolicy.auth.token.length).toBeGreaterThanOrEqual(8);
    expect(shippedPolicy.auth.token).not.toBe("change-me");
    expect(shippedPolicy.digest.enabled).toBe(true);
    expect(shippedPolicy.storage.writable).toEqual(["/app/state/quarantine"]);
    // The container path the policy has to name, which is not the checkout path.
    expect(shippedPolicy.storage.writable).not.toContain("/app/state/digest");

    const config = JSON.parse(
      readFileSync(join(composeDir, "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    expect(config.acceptingPosts).toBe(true);
  });

  it("should document the container path the policy must name, not only the checkout path", () => {
    // `storage.writable` is compared against `/app/state/digest` inside the
    // container. Publishing only the checkout path would have the participant
    // write a value that can never match.
    for (const name of ["README.md", "README.ja.md"]) {
      expect(readFileSync(join(PROBLEM_DIR, name), "utf8")).toContain("/app/state/digest");
    }
  });
});
