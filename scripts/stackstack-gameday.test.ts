import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

/**
 * The StackStack GameDay Battle: seven single problems run as one continuous
 * event on one board.
 *
 * Everything below drives the REAL app — `stackstack-base/app/server.mjs` with
 * `SCENARIO=gameday` — over REAL HTTP, with the starter files this problem
 * actually ships, on a compressed clock. No Docker, no AWS, no assertions about
 * source text.
 *
 * Three classes of thing are pinned here, and each exists because the
 * composition could break it silently:
 *
 *   1. The composition itself. Route keys, posture namespaces, and the
 *      PROVENANCE of every scored predicate — decided by object identity against
 *      each source module's own `gates` export. A future edit that replaces an
 *      imported predicate with a hand-written lookalike turns its provenance
 *      into "gameday" and fails here. A comment claiming reuse cannot do that.
 *   2. The two scoring rules the issue states in prose. "Stopping the service to
 *      fix a security problem must not score full marks" is the error budget;
 *      "keeping the service up while leaving the vulnerability must not score
 *      full marks" is the hold. Both are asserted as behaviour, not as text.
 *   3. The three chains, each measured from the state the participant's own file
 *      produces — including the assertion that chain 2 is NOT already implied by
 *      the phase it chains from, which is the way a chain goes vacuous.
 */

/**
 * Several assertions wait for a compressed plan to reach a later phase, or for a
 * monotone counter to cross a threshold. Five seconds is not enough for any of
 * them, and a per-test timeout repeated twenty times is a worse way to say so.
 */
setDefaultTimeout(90_000);

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const PROBLEM = join(REPO_ROOT, "battles", "stackstack-gameday");
const STARTERS = join(PROBLEM, "local");

/** The board serial is seed-derived, exactly as `secrets.mjs` derives it. */
const boardSerial = (seed: string) =>
  `SS-${createHash("sha256").update(`serial:${seed}`).digest("hex").slice(0, 8)}`;

interface Ports {
  readonly challenge: number;
  readonly verify: number;
}

interface Started {
  readonly process: ReturnType<typeof spawn>;
  readonly stderr: () => string;
  readonly exited: Promise<number | null>;
  readonly scratch: string;
  readonly ports: Ports;
}

const scratches: string[] = [];

/**
 * A scratch checkout seeded with the starter files the problem really ships, so
 * the suite grades the shipped starting state rather than one it invented.
 */
function checkout(): string {
  const directory = mkdtempSync(join(tmpdir(), "stackstack-gameday-"));
  scratches.push(directory);
  for (const name of ["config", "feature", "release", "access", "policy", "relay", "ops"]) {
    mkdirSync(join(directory, name));
    cpSync(join(STARTERS, name), join(directory, name), { recursive: true });
  }
  return directory;
}

const file = (scratch: string, relative: string) => join(scratch, relative);

const writeJson = (scratch: string, relative: string, value: unknown) =>
  writeFileSync(file(scratch, relative), JSON.stringify(value, null, 2));

const readJsonFile = (scratch: string, relative: string) =>
  JSON.parse(readFileSync(file(scratch, relative), "utf8")) as Record<string, unknown>;

function start(
  scratch: string,
  ports: Ports,
  overrides: Record<string, string> = {},
): Started {
  let stderr = "";
  const child = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "gameday",
      FLAG_SEED: overrides.FLAG_SEED ?? "gameday-suite-seed",
      CHALLENGE_PORT: String(ports.challenge),
      VERIFY_PORT: String(ports.verify),
      APP_CONFIG: file(scratch, "config/app.json"),
      APP_FEATURE: file(scratch, "feature/search.mjs"),
      RELEASE_MANIFEST: file(scratch, "release/release.json"),
      GAMEDAY_EXPOSURE_POLICY: file(scratch, "access/access.json"),
      GAMEDAY_DESK_POLICY: file(scratch, "policy/access.json"),
      RELAY_CONFIG: file(scratch, "relay/relay.json"),
      OPS_MANIFEST: file(scratch, "ops/ops.json"),
      STACKSTACK_GAMEDAY_MINUTES: "90",
      STACKSTACK_GAMEDAY_TICK_MS: "60",
      DEFEND_INTERVAL_MS: "150",
      DEFEND_WINDOW_ROUNDS: "3",
      DEFEND_HOLD_MS: "300",
      ...overrides,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return {
    process: child,
    stderr: () => stderr,
    exited: new Promise((resolve) => child.on("exit", (code) => resolve(code))),
    scratch,
    ports,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBoard(port: number, deadlineMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return true;
    } catch {
      // not listening yet
    }
    await sleep(40);
  }
  return false;
}

const get = async (port: number, path: string, headers: Record<string, string> = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  return { status: response.status, body };
};

const post = async (port: number, path: string, payload?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: payload === undefined ? {} : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { text };
  }
  return { status: response.status, body };
};

/**
 * The event surfaces are read as `any` deliberately. Declaring a mirror of every
 * response shape here would be a second copy of the contract, and the first thing
 * it would do is stop the suite noticing when the real one changes.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: the response shape belongs to the app, not to this file
const state = async (port: number) => (await get(port, "/gameday/state")).body as any;
const score = async (port: number) => (await get(port, "/gameday/score")).body as any;
const results = async (port: number) => (await get(port, "/gameday/results")).body as any;
const posture = async (port: number) => (await get(port, "/posture")).body as any;

const verify = async (ports: Ports, checkpointId: string, submission: string) =>
  (
    await (
      await fetch(`http://127.0.0.1:${ports.verify}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId, submission }),
      })
    ).json()
  ) as { checkpointId: string; correct: boolean };

/** Poll until a condition over the event state holds, or give up and return the last state. */
async function until(
  port: number,
  predicate: (snapshot: any) => boolean,
  timeoutMs = 12_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await state(port);
  while (Date.now() < deadline) {
    if (predicate(snapshot)) return snapshot;
    await sleep(60);
    snapshot = await state(port);
  }
  return snapshot;
}

afterAll(() => {
  for (const directory of scratches.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// fixtures the tests write into the scratch checkout
// ---------------------------------------------------------------------------

/** The starter search, with the one thing it gets wrong put right. */
function fixedSearch(scratch: string): string {
  const source = readFileSync(file(scratch, "feature/search.mjs"), "utf8");
  return source.replace(
    "  const matches = posts\n    .filter(",
    '  const matches = posts\n    .filter((post) => post.visibility === "public")\n    .filter(',
  );
}

/** A search implementation that cannot load at all — the bluntest possible outage. */
const BROKEN_SEARCH = `export function search() { throw new Error("down for maintenance"); }
export function renderResults() { throw new Error("down for maintenance"); }
`;

/**
 * An access document that satisfies every one of `safe-exposure`'s groups —
 * service intact, drafts usable, drafts scoped, admin available, admin sealed.
 *
 * It has to be all five rather than just `service_intact`, for two separate
 * reasons that both bit here. Chain 2 below claims a document can satisfy the
 * whole Expose phase and still be wrong about the incident page; a document that
 * only kept the service up would make that claim vacuous. And the winning path
 * writes this document as its Expose step, so anything it fails to satisfy holds
 * `portal-authn` red and the event cannot be won at all.
 *
 * The earlier version had GET rules only. `drafts_usable` needs the owner to be
 * able to write and remove, and `drafts_scoped` is measured against drafts the
 * probe writes first — so with no write rule both groups failed, and the event
 * was unwinnable for a reason that looked like a scoring bug.
 */
const EXPOSE_SOLVED_POLICY = {
  defaultEffect: "deny",
  rules: [
    { id: "monitoring", effect: "allow", methods: ["GET"], path: "/portal/healthz", require: [] },
    {
      id: "admin-console",
      effect: "allow",
      methods: ["*"],
      path: "/portal/admin/*",
      require: ["authenticated", "role:admin"],
    },
    { id: "whoami", effect: "allow", methods: ["GET"], path: "/portal/me", require: ["authenticated"] },
    {
      id: "my-drafts",
      effect: "allow",
      methods: ["GET", "POST"],
      path: "/portal/drafts",
      require: ["authenticated"],
    },
    {
      id: "own-draft",
      effect: "allow",
      methods: ["GET", "DELETE"],
      path: "/portal/draft",
      require: ["authenticated", "owner"],
    },
    {
      id: "shared-draft",
      effect: "allow",
      methods: ["GET"],
      path: "/portal/draft",
      require: ["authenticated", "tenant", "shared"],
    },
  ],
};

/** The same document, plus the two ordered rules the incident page needs. */
const INCIDENT_READY_POLICY = {
  defaultEffect: "deny",
  rules: [
    ...EXPOSE_SOLVED_POLICY.rules,
    {
      id: "incident-not-public",
      effect: "deny",
      methods: ["GET"],
      path: "/portal/incident",
      require: ["anonymous"],
    },
    {
      id: "incident-for-customers",
      effect: "allow",
      methods: ["GET"],
      path: "/portal/incident",
      require: ["authenticated"],
    },
  ],
};

// ---------------------------------------------------------------------------

describe("the composition is a composition, not a second implementation", () => {
  const ports = { challenge: 18370, verify: 18371 };
  let app: Started;

  beforeAll(async () => {
    app = start(checkout(), ports, { STACKSTACK_GAMEDAY_SCALE: "1" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should mount every constituent's routes with no duplicate and no base-route collision", async () => {
    const snapshot = await state(ports.challenge);
    // The enumeration lives here rather than in a design document, because a
    // count in prose has already been wrong twice about this exact question.
    expect(snapshot.composition.routes.duplicates).toEqual([]);
    expect(snapshot.composition.routes.baseCollisions).toEqual([]);
    const declared = snapshot.composition.contributors.reduce(
      (total: number, entry: any) => total + entry.routes,
      0,
    );
    expect(snapshot.composition.routes.total).toBe(declared);
    expect(snapshot.composition.routes.total).toBeGreaterThan(40);
  });

  it("should merge exactly the six posture namespaces the constituents declare", async () => {
    const snapshot = await state(ports.challenge);
    expect(snapshot.composition.namespaces).toEqual([
      "ship",
      "vibe",
      "exposure",
      "ops",
      "relay",
      "defend",
    ]);
  });

  it("should score predicates that are the imported objects, not lookalikes", async () => {
    const { facts } = (await state(ports.challenge)).composition;
    // Every scored predicate resolves, by object identity, to the gate its own
    // module exports. The one exception is declared and explained in the module.
    expect(facts).toMatchObject({
      joinOpen: "onboarding.posts_open",
      joinWrote: "onboarding.post_created",
      vibeAnswers: "vibe.search_answers",
      vibeWithheld: "vibe.drafts_withheld",
      shipServing: "ship.site_serving",
      shipSingle: "ship.single_release",
      shipRotation: "ship.survives_key_rotation",
      exposeSealed: "exposure.admin_sealed",
      exposeScoped: "exposure.drafts_scoped",
      exposeService: "exposure.service_intact",
      deskService: "defend.service_intact",
      deskReads: "defend.reads_held",
      deskPublishes: "defend.publishes_held",
      relayTraffic: "relay.traffic_seen",
      relayLogged: "relay.failures_logged",
      relayHonest: "relay.health_honest",
      relayClean: "relay.credential_out_of_logs",
      opsRevoked: "ops.legacy_revoked",
      opsLeast: "ops.least_privilege",
      opsService: "ops.service_intact",
    });
  });

  it("should score nothing that answers without looking at the state it is about", async () => {
    // The hazard composition creates: a gate upstream that has drifted to a
    // constant still type-checks, still shows a provenance, and still reads like
    // a measurement. Scored here it would be a vacuous pass. Each predicate is
    // run against a context whose own namespace throws on any read; one that
    // answers anyway never looked.
    const snapshot = await state(ports.challenge);
    expect(snapshot.composition.vacuousScoredFacts).toEqual([]);
  });

  it("should declare every predicate it did not import, with its reason", async () => {
    const { facts, reexpressed } = (await state(ports.challenge)).composition;
    for (const [name, source] of Object.entries(facts)) {
      if (source !== "gameday") continue;
      // A predicate this scenario wrote itself is allowed only with a stated
      // reason, so "we import rather than reimplement" cannot quietly erode.
      expect(Object.keys(reexpressed), name).toContain(name);
      expect(String(reexpressed[name as keyof typeof reexpressed]).length).toBeGreaterThan(40);
    }
    // The map is empty, which is the goal state: every scored predicate is the
    // object its own module exports, so there is nothing here to justify.
    //
    // It was not empty when this scenario was written. `deskPublishes` was a
    // hand-written lookalike, carrying a stated reason that turned out to be
    // false — `defend.mjs` never exported `gates.publishes_held` as a constant.
    // The gate was genuinely unreachable, but for a different reason: the drill
    // sampled its publish probes, so some rounds probed nothing and
    // `a.publish.total === 0` held the gate red whatever the participant did.
    // Fixing the sampling in `defend.mjs` removed the need for the workaround,
    // and the declaration that survived it was a false statement about a
    // sibling module sitting in the composition's own defect report.
    //
    // Which is the argument for asserting emptiness rather than asserting the
    // exception: a stated reason is prose, and prose does not stay true.
    expect(reexpressed).toEqual({});
    expect(Object.values(facts)).not.toContain("gameday");
  });

  it("should give the two access documents two different files", async () => {
    const snapshot = await state(ports.challenge);
    expect(snapshot.composition.accessDocuments.portal).not.toBe(
      snapshot.composition.accessDocuments.desk,
    );
    // Behavioural, not just a path comparison: the two documents have different
    // schemas, so if they shared a file exactly one of them would fail to load.
    expect((await get(ports.challenge, "/portal/review")).body).toMatchObject({
      policy: { loaded: true },
    });
    expect((await get(ports.challenge, "/api/policy")).body).toMatchObject({ ok: true });
  });

  it("should keep every constituent's diagnostic surface reachable", async () => {
    for (const path of [
      "/gameday",
      "/api/spec",
      "/api/selfcheck",
      "/api/feature",
      "/shipyard",
      "/shipyard/state",
      "/portal",
      "/portal/review",
      "/desk",
      "/api/drill",
      "/api/policy",
      "/relay",
      "/relay/state",
      "/metrics",
      "/api/ops",
      "/api/ops/policy",
      "/api/ops/state",
    ]) {
      expect((await get(ports.challenge, path)).status, path).toBe(200);
    }
  });

  it("should still run the participant's code somewhere it cannot read FLAG_SEED", async () => {
    // vibe-build spawns the feature with `env: {}` in a child process. Five more
    // modules' state now lives in the parent, so the property is re-pinned here
    // rather than assumed to have survived composition.
    writeFileSync(
      file(app.scratch, "feature/search.mjs"),
      `export function search() {
  return { status: 200, body: { query: String(process.env.FLAG_SEED ?? "absent"), matches: [] } };
}
export function renderResults() { return "<p>x</p>"; }
`,
    );
    const answer = await get(ports.challenge, "/api/search?q=anything");
    expect(answer.status).toBe(200);
    expect(answer.body.query).toBe("absent");
  });

  it("should not let scorer traffic satisfy a gate on the participant's behalf", async () => {
    // The scorer asks the board and the search surface on every tick, and
    // `server.mjs` records every route it serves. A gate written over `observed`
    // would be raised by the act of scoring; none of this event's are, and the
    // Join gate stays false until the config is opened and a post is written.
    const before = await posture(ports.challenge);
    expect(before.gates.gameday_join).toBe(false);
    expect(before.tokens.gameday_join).toBeNull();
  });
});

describe("the duration switch", () => {
  it("should move only the schedule and the hold between 90 and 120", async () => {
    const short = start(checkout(), { challenge: 18372, verify: 18373 }, {
      STACKSTACK_GAMEDAY_MINUTES: "90",
      STACKSTACK_GAMEDAY_SCALE: "1",
    });
    const long = start(checkout(), { challenge: 18374, verify: 18375 }, {
      STACKSTACK_GAMEDAY_MINUTES: "120",
      STACKSTACK_GAMEDAY_SCALE: "1",
    });
    try {
      expect(await waitForBoard(18372), short.stderr().slice(0, 400)).toBe(true);
      expect(await waitForBoard(18374), long.stderr().slice(0, 400)).toBe(true);
      const a = await state(18372);
      const b = await state(18374);
      expect(a.event.minutes).toBe(90);
      expect(b.event.minutes).toBe(120);
      expect(a.event.schedule.stabilize.atMinutes).toBe(70);
      expect(b.event.schedule.stabilize.atMinutes).toBe(95);
      expect((await score(18374)).holdMs).toBeGreaterThan((await score(18372)).holdMs);
      // What is required does not move: same probe set, same security facts.
      expect(Object.keys(a.security.facts)).toEqual(Object.keys(b.security.facts));
      expect(a.availability.probes.map((p: any) => p.name)).toEqual(
        b.availability.probes.map((p: any) => p.name),
      );
    } finally {
      short.process.kill();
      long.process.kill();
    }
  });

  it("should refuse to boot on a duration nobody supports", async () => {
    // An organiser who discovers forty minutes in that their 120-minute event is
    // running the 90-minute schedule cannot recover. Fail at boot instead.
    const app = start(checkout(), { challenge: 18376, verify: 18377 }, {
      STACKSTACK_GAMEDAY_MINUTES: "105",
    });
    const code = await Promise.race([
      app.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    app.process.kill();
    expect(code).toBe(1);
    expect(app.stderr()).toContain("STACKSTACK_GAMEDAY_MINUTES must be 90 or 120");
  });
});

describe("create, run, finish, tear down", () => {
  const ports = { challenge: 18378, verify: 18379 };
  const seed = "gameday-e2e-seed";
  let app: Started;

  beforeAll(async () => {
    // 900× compression: the whole 90-minute plan walks in about six seconds.
    app = start(checkout(), ports, { FLAG_SEED: seed, STACKSTACK_GAMEDAY_SCALE: "900" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should pay every team a first point for one page load, before anything else", async () => {
    // The cheapest check in the event, and deliberately the first: no config
    // edit, no write, no phase to wait for. This is the floor the "first score
    // within fifteen minutes" requirement actually needs.
    const board = await get(ports.challenge, "/api/board");
    expect(board.body.serial).toBe(boardSerial(seed));
    const verdict = await verify(ports, "join", String(board.body.serial));
    expect(verdict).toMatchObject({ checkpointId: "join", correct: true });
  });

  it("should refuse a checkpoint whose phase has not opened, even when its facts are green", async () => {
    // The Stabilize phase is time-only. Whatever else is true, its receipt does
    // not exist before the phase opens — so the time condition conditions
    // something rather than being decoration.
    const early = await state(ports.challenge);
    if (!early.event.schedule.stabilize.open) {
      const stabilize = await posture(ports.challenge);
      expect(stabilize.gates.gameday_stabilize).toBe(false);
      expect(stabilize.tokens.gameday_stabilize).toBeNull();
    }
    expect((await verify(ports, "stabilize", "anything at all")).correct).toBe(false);
  });

  it("should open every phase in order as the plan runs", async () => {
    const snapshot = await until(
      ports.challenge,
      (s) => s.event.schedule.stabilize.open === true,
      20_000,
    );
    const opened = snapshot.phases.filter((phase: any) => phase.open).map((p: any) => p.name);
    expect(opened).toEqual([
      "join",
      "build",
      "ship",
      "expose",
      "attack",
      "incident",
      "stabilize",
    ]);
    // Opened in schedule order, never out of it.
    const times = snapshot.phases.map((phase: any) => phase.openedAtMs as number);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]).toBeGreaterThanOrEqual(times[index - 1]);
    }
  });

  it("should rotate the signing key exactly once, however many ticks run past the phase", async () => {
    // The rotation is idempotent by construction rather than by a flag: it runs
    // only while the store is still at the version it held when Stabilize
    // opened. A retried tick must not rotate twice.
    //
    // Wait for the rotation rather than assuming the tick has already run.
    // Reading straight after the phase opens races the tick that does the
    // rotating, and the race is only lost under load — this passed on its own
    // and failed inside a full shard, which is the worst way for a test to be
    // wrong. Waiting costs nothing when the tick has already fired.
    const version = async () =>
      ((await get(ports.challenge, "/shipyard/secrets")).body as any).secrets[0].version as number;
    const deadline = Date.now() + 20_000;
    while ((await version()) < 2 && Date.now() < deadline) await sleep(60);

    expect(await version()).toBe(2);
    // The "exactly once" half, and the reason this test exists: several more
    // ticks run past Stabilize, and none of them may rotate again.
    await sleep(1_000);
    expect(await version()).toBe(2);
  });

  it("should hand back a per-phase result ledger at the end", async () => {
    const ledger = await results(ports.challenge);
    expect(ledger.phases.map((phase: any) => phase.phase)).toEqual([
      "join",
      "build",
      "ship",
      "expose",
      "attack",
      "incident",
      "stabilize",
    ]);
    for (const phase of ledger.phases) {
      expect(phase).toHaveProperty("openedAtMs");
      expect(phase).toHaveProperty("greenAtEnd");
      expect(Object.keys(phase.facts).length).toBeGreaterThan(0);
    }
    expect(ledger.availability.probes.map((probe: any) => probe.name)).toContain("monitor");
    expect(ledger.score).toHaveProperty("integralMs");
    expect(ledger.event.boardSerial).toBe(boardSerial(seed));
  });

  it("should still be a well application after a full compressed event", async () => {
    // Six modules, two background timers, a spawned child process and the
    // scorer's own loop in one process. An uncaught fault anywhere would mark
    // the board unwell for the rest of the run with no way to clear it.
    const health = await get(ports.challenge, "/healthz");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, faults: [] });
  });

  it("should keep the relay's own log lines alive through a busy run", async () => {
    // `currentEpochLines()` reads a 500-line ring. Relay lines are produced only
    // by participant posts, so anything that logs per tick would evict the
    // evidence the Incident and Stabilize phases are graded on. Nothing in this
    // scenario's loop writes to that ring; this is the regression guard.
    writeJson(app.scratch, "relay/relay.json", {
      archiveLogging: "on",
      healthCheckProbes: ["config", "archive"],
      logDetail: "safe",
    });
    writeJson(app.scratch, "config/app.json", {
      boardTitle: "board",
      acceptingPosts: true,
    });
    for (let index = 0; index < 24; index += 1) {
      await post(ports.challenge, "/api/posts", {
        author: "sre",
        title: `ring probe ${index}`,
        body: "x",
      });
    }
    await sleep(1_500);
    const relay = (await get(ports.challenge, "/relay/state")).body as any;
    expect(relay.signal.archivedLinesThisEpoch).toBeGreaterThan(0);
    expect(relay.signal.dropLinesThisEpoch).toBeGreaterThan(0);
  });

  it("should tear down cleanly when the run ends", async () => {
    app.process.kill("SIGKILL");
    await Promise.race([
      app.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    // The whole event lives in one process: when it goes, the board, /verify,
    // the drill, the relay and the participant's child process go with it.
    await sleep(300);
    await expect(fetch(`http://127.0.0.1:${ports.challenge}/healthz`)).rejects.toBeDefined();
    await expect(fetch(`http://127.0.0.1:${ports.verify}/healthz`)).rejects.toBeDefined();
  });
});

describe('rule 1 — "stopping the service to fix a security problem" cannot reach full marks', () => {
  const ports = { challenge: 18380, verify: 18381 };
  let app: Started;

  let working = "";

  beforeAll(async () => {
    const scratch = checkout();
    working = fixedSearch(scratch);
    writeFileSync(file(scratch, "feature/search.mjs"), working);
    app = start(scratch, ports, { STACKSTACK_GAMEDAY_SCALE: "900" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should commit a path only once it has actually worked", async () => {
    // Nobody is charged for the time before they had anything to serve. What
    // the budget charges for is taking away something you had.
    const snapshot = await until(
      ports.challenge,
      (s) => s.availability.probes.find((p: any) => p.name === "search")?.armed === true,
    );
    const search = snapshot.availability.probes.find((probe: any) => probe.name === "search");
    expect(search.armed).toBe(true);
    const site = snapshot.availability.probes.find((probe: any) => probe.name === "site");
    expect(site.armed).toBe(false);
    expect(site.armedTicks).toBe(0);
    expect(snapshot.availability.withinBudget).toBe(true);
  });

  it("should spend the availability allowance when a working path is taken away", async () => {
    writeFileSync(file(app.scratch, "feature/search.mjs"), BROKEN_SEARCH);
    const blown = await until(ports.challenge, (s) => s.availability.withinBudget === false, 20_000);
    expect(blown.availability.withinBudget).toBe(false);
    expect(blown.availability.budget.degradedTicks).toBeGreaterThan(
      blown.availability.budget.allowed,
    );
  });

  it("should not give the allowance back when the service is restored", async () => {
    // This is the whole point. A product over ticks removes the reward for being
    // dark; only a monotone counter imposes a cost that survives to the verdict.
    // With a refundable budget, "go dark, work in peace, come back clean" is a
    // free planning tool.
    writeFileSync(file(app.scratch, "feature/search.mjs"), working);
    const restored = await until(
      ports.challenge,
      (s) => s.availability.probes.find((p: any) => p.name === "search")?.green === true,
    );
    expect(restored.availability.probes.find((p: any) => p.name === "search").green).toBe(true);
    expect(restored.availability.share).toBe(1);
    expect(restored.availability.withinBudget).toBe(false);
  });

  it("should fail every phase check and the sign-off once the allowance is spent", async () => {
    const gates = (await posture(ports.challenge)).gates;
    for (const gate of [
      "gameday_build",
      "gameday_ship",
      "gameday_expose",
      "gameday_attack",
      "gameday_incident",
      "gameday_stabilize",
      "gameday_signoff",
    ]) {
      expect(gates[gate], gate).toBe(false);
    }
    // ...and the receipt for the phase whose facts are otherwise green is
    // withheld, so it cannot be answered from a value seen earlier either.
    expect((await posture(ports.challenge)).tokens.gameday_build).toBeNull();
    expect((await verify(ports, "build", "anything")).correct).toBe(false);
  });
});

describe('rule 2 — "keeping the service up while leaving the vulnerability" cannot reach full marks', () => {
  const ports = { challenge: 18382, verify: 18383 };
  let app: Started;

  beforeAll(async () => {
    const scratch = checkout();
    // The service half is fine; the security half is the untouched starter.
    writeFileSync(file(scratch, "feature/search.mjs"), fixedSearch(scratch));
    app = start(scratch, ports, { STACKSTACK_GAMEDAY_SCALE: "900" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should hold availability at 1 while security is short", async () => {
    const snapshot = await until(
      ports.challenge,
      (s) => s.availability.share === 1 && s.availability.probes.some((p: any) => p.armed),
    );
    expect(snapshot.availability.share).toBe(1);
    expect(snapshot.availability.withinBudget).toBe(true);
    expect(snapshot.security.share).toBeLessThan(1);
  });

  it("should never start the hold while one security fact is short", async () => {
    // A team that is up and open has availability all day. The sign-off asks for
    // both at once, continuously — so the timer does not start once.
    await sleep(1_000);
    const live = await score(ports.challenge);
    expect(live.availability).toBe(1);
    expect(live.security).toBeLessThan(1);
    expect(live.heldForMs).toBe(0);
    expect(live.holdSatisfied).toBe(false);
  });

  it("should cap the continuous score below the maximum for the whole run", async () => {
    const live = await score(ports.challenge);
    // A × S, not A + S: a perfect availability half cannot carry a short
    // security half to the maximum, and the deficit accumulates.
    expect(live.share).toBeLessThan(1);
    expect((await posture(ports.challenge)).gates.gameday_signoff).toBe(false);
    expect((await verify(ports, "signoff", "anything"))?.correct).toBe(false);
  });
});

describe("chain 1 — the key pasted into the release decides what the scheduled rotation does", () => {
  const ports = { challenge: 18384, verify: 18385 };
  let app: Started;
  let artifact = "";
  let keyValue = "";

  beforeAll(async () => {
    // Slow enough that Stabilize does not arrive before the release is deployed.
    app = start(checkout(), ports, { STACKSTACK_GAMEDAY_SCALE: "300" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
    artifact = String(((await get(ports.challenge, "/shipyard/artifacts")).body as any).artifacts[0].id);
    keyValue = String(((await get(ports.challenge, "/shipyard/secrets/value")).body as any).value);
  });
  afterAll(() => app?.process.kill());

  it("should deploy and serve a release that pasted the key value", async () => {
    // The health gate only asks whether the candidate can sign with the key the
    // store holds right now, and a fresh copy can. That is why the failure it
    // causes arrives later.
    writeJson(app.scratch, "release/release.json", {
      artifact,
      env: { BOARD_PUBLIC_TITLE: "社内掲示板", BOARD_SIGNING_KEY: keyValue },
    });
    expect((await post(ports.challenge, "/shipyard/releases")).status).toBe(201);
    // Somebody other than the scorer has to have reached it, so the suite does
    // what a participant does.
    expect((await get(ports.challenge, "/site")).status).toBe(200);
    const shipyard = (await get(ports.challenge, "/shipyard/state")).body as any;
    expect(shipyard.site.status).toBe(200);
    expect(shipyard.site.answeredForCurrentRelease).toBe(true);
  });

  it("should report, before anything happens, that the release will not survive the next rotation", async () => {
    const snapshot = await until(
      ports.challenge,
      (s) => s.availability.probes.find((p: any) => p.name === "site")?.armed === true,
    );
    expect(snapshot.availability.probes.find((p: any) => p.name === "site").green).toBe(true);
    expect(snapshot.security.facts["release-binding"]).toBe(false);
  });

  it("should take the published entrance down when the scheduled rotation runs", async () => {
    const snapshot = await until(
      ports.challenge,
      (s) =>
        s.event.schedule.stabilize.open === true &&
        s.availability.probes.find((p: any) => p.name === "site")?.green === false,
      40_000,
    );
    expect(snapshot.event.schedule.stabilize.open).toBe(true);
    const site = await get(ports.challenge, "/site/healthz");
    expect(site.status).toBe(503);
    expect(site.body.error).toBe("signature_rejected");
    expect(snapshot.availability.probes.find((p: any) => p.name === "site").green).toBe(false);
    // The hold cannot be running through an outage.
    expect((await score(ports.challenge)).heldForMs).toBe(0);
  });

  it("should be a non-event for a release that shipped a reference instead", async () => {
    writeJson(app.scratch, "release/release.json", {
      artifact,
      env: {
        BOARD_PUBLIC_TITLE: "社内掲示板",
        BOARD_SIGNING_KEY: { fromSecret: "board-signing-key" },
      },
    });
    expect((await post(ports.challenge, "/shipyard/releases")).status).toBe(201);
    expect((await get(ports.challenge, "/site")).status).toBe(200);
    const snapshot = await until(
      ports.challenge,
      (s) =>
        s.security.facts["release-binding"] === true &&
        s.availability.probes.find((p: any) => p.name === "site")?.green === true,
      30_000,
    );
    expect(snapshot.security.facts["release-binding"]).toBe(true);
    expect(snapshot.availability.probes.find((p: any) => p.name === "site").green).toBe(true);
  });
});

describe("chain 2 — the access document written in Expose decides the Incident page", () => {
  const ports = { challenge: 18386, verify: 18387 };
  let app: Started;

  beforeAll(async () => {
    app = start(checkout(), ports, { STACKSTACK_GAMEDAY_SCALE: "900" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should not be implied by the phase it chains from", async () => {
    // The way a chain goes vacuous is that the later phase measures something
    // the earlier phase already required. safe-exposure's `service_intact` group
    // does not touch this path, so a document that satisfies every Expose group
    // can still be wrong about it — which is the entire chain.
    writeJson(app.scratch, "access/access.json", EXPOSE_SOLVED_POLICY);
    const snapshot = await until(
      ports.challenge,
      (s) => s.incidentPage.customer !== "policy_error",
    );
    const review = (await get(ports.challenge, "/portal/review")).body as any;
    // Every Expose group, not just the one the chain is most obviously near. If
    // this only asserted `service_intact`, a document that failed the others
    // would still reach the incident assertion below and the chain would be
    // claiming more than it measured.
    expect(
      Object.fromEntries(
        Object.entries(review.groups as Record<string, { ok: boolean }>).map(([name, group]) => [
          name,
          group.ok,
        ]),
      ),
    ).toEqual({
      service_intact: true,
      drafts_usable: true,
      drafts_scoped: true,
      admin_available: true,
      admin_sealed: true,
    });
    expect(snapshot.incidentPage.ok).toBe(false);
    expect(snapshot.incidentPage.customer).toBe("deny");
  });

  it("should refuse the customer through the same decision path a real request takes", async () => {
    const answer = await get(ports.challenge, "/portal/incident");
    expect(answer.status).toBe(401);
    expect(answer.body.decidedBy).toBe("default");
  });

  it("should also be wrong in the other direction when the document allows by default", async () => {
    writeJson(app.scratch, "access/access.json", {
      defaultEffect: "allow",
      rules: [
        { id: "monitoring", effect: "allow", methods: ["GET"], path: "/portal/healthz", require: [] },
      ],
    });
    const snapshot = await until(
      ports.challenge,
      (s) => s.incidentPage.anonymous === "allow",
    );
    expect(snapshot.incidentPage.ok).toBe(false);
    expect((await get(ports.challenge, "/portal/incident")).status).toBe(200);
  });

  it("should go green on two ordered rules, and keep the Expose groups green", async () => {
    writeJson(app.scratch, "access/access.json", INCIDENT_READY_POLICY);
    const snapshot = await until(ports.challenge, (s) => s.incidentPage.ok === true);
    expect(snapshot.incidentPage.ok).toBe(true);
    expect(snapshot.incidentPage.customer).toBe("allow");
    expect(snapshot.incidentPage.anonymous).toBe("deny");
    const review = (await get(ports.challenge, "/portal/review")).body as any;
    expect(review.groups.service_intact.ok).toBe(true);
    expect((await get(ports.challenge, "/portal/incident")).status).toBe(401);
  });

  it("should report the probe before it is scored, so nothing arrives as a surprise", async () => {
    const snapshot = await state(ports.challenge);
    const monitor = snapshot.availability.probes.find((probe: any) => probe.name === "monitor");
    expect(monitor).toBeDefined();
    expect(monitor.opensAt).toBe("incident");
    expect(typeof monitor.note).toBe("string");
    expect(monitor.note.length).toBeGreaterThan(0);
  });
});

describe("chain 3 — the log turned on for the incident is what leaks the credential", () => {
  const ports = { challenge: 18388, verify: 18389 };
  let app: Started;

  beforeAll(async () => {
    const scratch = checkout();
    writeJson(scratch, "config/app.json", { boardTitle: "board", acceptingPosts: true });
    app = start(scratch, ports, { STACKSTACK_GAMEDAY_SCALE: "900" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  const writePosts = async (tag: string) => {
    for (let index = 0; index < 24; index += 1) {
      await post(ports.challenge, "/api/posts", {
        author: "sre",
        title: `${tag} ${index}`,
        body: "x",
      });
    }
    await sleep(1_400);
  };

  it("should have nothing to investigate while the log is off", async () => {
    await writePosts("silent");
    const snapshot = await state(ports.challenge);
    // Writes really are being lost, and the app is saying nothing about it.
    expect(snapshot.security.facts["log-hygiene"]).toBe(false);
    const relay = (await get(ports.challenge, "/relay/state")).body as any;
    expect(relay.archive.dropped).toBeGreaterThan(0);
    expect(relay.signal.dropLinesThisEpoch).toBe(0);
  });

  it("should start leaking the moment the log is turned on to diagnose it", async () => {
    writeJson(app.scratch, "relay/relay.json", {
      archiveLogging: "on",
      healthCheckProbes: ["config", "archive"],
      logDetail: "full",
    });
    await writePosts("leaking");
    const relay = (await get(ports.challenge, "/relay/state")).body as any;
    expect(relay.signal.dropLinesThisEpoch).toBeGreaterThan(0);
    expect(relay.credentialVisibleIn).toEqual(["log"]);
    expect((await state(ports.challenge)).security.facts["log-hygiene"]).toBe(false);
  });

  it("should not accept blanking the tail as a redaction", async () => {
    writeJson(app.scratch, "relay/relay.json", {
      archiveLogging: "on",
      healthCheckProbes: ["config", "archive"],
      logDetail: "masked",
    });
    await writePosts("masked");
    const relay = (await get(ports.challenge, "/relay/state")).body as any;
    expect(relay.credentialVisibleIn).toEqual(["log"]);
    expect((await state(ports.challenge)).security.facts["log-hygiene"]).toBe(false);
  });

  it("should not accept cutting the investigation out along with the secret", async () => {
    // An empty log carries no credential, and calling that clean is the exact
    // shape of vacuous pass this catalog has shipped before. The gate carries a
    // correctness precondition: the log has to be a usable record first.
    writeJson(app.scratch, "relay/relay.json", {
      archiveLogging: "on",
      healthCheckProbes: ["config", "archive"],
      logDetail: "minimal",
    });
    await writePosts("minimal");
    const relay = (await get(ports.challenge, "/relay/state")).body as any;
    // The credential really is gone — observability's own gate is satisfied.
    expect(relay.credentialVisibleIn).toEqual([]);
    // ...and the fact still fails, because the imported `leak-shut`
    // precondition asks that the lines still name the shard, its code, the
    // target and the epoch. A line cut down to an id is not a redaction.
    const snapshot = await state(ports.challenge);
    expect(snapshot.security.facts["log-hygiene"]).toBe(false);
    const stabilize = (await results(ports.challenge)).phases.find(
      (phase: any) => phase.phase === "stabilize",
    );
    expect(stabilize.facts.credential_out_of_logs).toBe(true);
    expect(stabilize.facts.log_investigation_intact).toBe(false);
  });

  it("should close it only for a log that still says what happened", async () => {
    writeJson(app.scratch, "relay/relay.json", {
      archiveLogging: "on",
      healthCheckProbes: ["config", "archive"],
      logDetail: "safe",
    });
    await writePosts("safe");
    const relay = (await get(ports.challenge, "/relay/state")).body as any;
    expect(relay.credentialVisibleIn).toEqual([]);
    expect(relay.signal.dropLinesThisEpoch).toBeGreaterThan(0);
    expect(relay.signal.archivedLinesThisEpoch).toBeGreaterThan(0);
    expect((await state(ports.challenge)).security.facts["log-hygiene"]).toBe(true);
  });
});

describe("a phase's receipt does not exist before its phase opens", () => {
  const ports = { challenge: 18390, verify: 18391 };
  let app: Started;

  beforeAll(async () => {
    // Real clock: nothing but Join is anywhere near its scheduled time, so the
    // only thing that can open a phase here is its condition.
    const scratch = checkout();
    writeFileSync(file(scratch, "feature/search.mjs"), fixedSearch(scratch));
    app = start(scratch, ports, { STACKSTACK_GAMEDAY_SCALE: "1" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
  });
  afterAll(() => app?.process.kill());

  it("should have only Join open at the start of the event", async () => {
    const snapshot = await until(
      ports.challenge,
      (s) => s.event.schedule.join.open === true,
      15_000,
    );
    expect(snapshot.event.schedule.join.open).toBe(true);
    for (const name of ["build", "attack", "incident", "stabilize"]) {
      expect(snapshot.event.schedule[name].open, name).toBe(false);
    }
  });

  it("should withhold a phase's receipt while its facts are green but its phase is shut", async () => {
    // Build's facts are satisfied — the search answers and withholds what it
    // should — but Join's write has not happened and 8 minutes have not passed,
    // so the phase is closed. If the time and state conditions did not condition
    // anything, this receipt would already be collectable.
    const snapshot = await until(
      ports.challenge,
      (s) => s.security.facts["archive-scope"] === true,
      30_000,
    );
    expect(snapshot.security.facts["archive-scope"]).toBe(true);
    expect(snapshot.event.schedule.build.open).toBe(false);

    const gates = await posture(ports.challenge);
    expect(gates.gates.gameday_build).toBe(false);
    expect(gates.tokens.gameday_build).toBeNull();
    expect((await verify(ports, "build", "anything at all")).correct).toBe(false);
  });

  it("should open a phase as soon as its condition holds, without waiting for the clock", async () => {
    // Ship's condition is Build's facts, which are already true. It opens on the
    // condition, tens of minutes before its scheduled time — a fast team is
    // never held back by the clock.
    const snapshot = await until(
      ports.challenge,
      (s) => s.event.schedule.ship.open === true,
      30_000,
    );
    expect(snapshot.event.schedule.ship.open).toBe(true);
    expect(snapshot.event.elapsedMs).toBeLessThan(snapshot.event.schedule.ship.atMs);
  });
});

describe("the scorer's own traffic cannot raise a gate for the participant", () => {
  const ports = { challenge: 18392, verify: 18393 };
  let app: Started;

  beforeAll(async () => {
    app = start(checkout(), ports, { STACKSTACK_GAMEDAY_SCALE: "60" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);
    const artifact = String(
      ((await get(ports.challenge, "/shipyard/artifacts")).body as any).artifacts[0].id,
    );
    writeJson(app.scratch, "release/release.json", {
      artifact,
      env: {
        BOARD_PUBLIC_TITLE: "社内掲示板",
        BOARD_SIGNING_KEY: { fromSecret: "board-signing-key" },
      },
    });
    expect((await post(ports.challenge, "/shipyard/releases")).status).toBe(201);
  });
  afterAll(() => app?.process.kill());

  it("should leave site_serving false while only the scorer has asked", async () => {
    // `ship.mjs` records "somebody other than the scorer asked and it answered"
    // and excludes requests carrying its scorer header. The GameDay's own site
    // probe sends that header; without it, composition would raise this gate on
    // the participant's behalf on the very first tick — a vacuous pass created by
    // the act of scoring, in a gate whose author built machinery to prevent it.
    const snapshot = await until(
      ports.challenge,
      (s) => s.availability.probes.find((p: any) => p.name === "site")?.armed === true,
      30_000,
    );
    expect(snapshot.availability.probes.find((p: any) => p.name === "site").green).toBe(true);
    const shipyard = (await get(ports.challenge, "/shipyard/state")).body as any;
    expect(shipyard.site.status).toBe(200);
    expect(shipyard.site.answeredForCurrentRelease).toBe(false);
    expect(
      snapshot.phases.find((phase: any) => phase.name === "ship").facts?.site_serving ?? false,
    ).toBe(false);
    const ledger = await results(ports.challenge);
    expect(ledger.phases.find((phase: any) => phase.phase === "ship").facts.site_serving).toBe(
      false,
    );
  });

  it("should flip only once a real visitor has reached the published site", async () => {
    expect((await get(ports.challenge, "/site")).status).toBe(200);
    const ledger = await results(ports.challenge);
    expect(ledger.phases.find((phase: any) => phase.phase === "ship").facts.site_serving).toBe(true);
  });
});

/**
 * The whole event, solved.
 *
 * This is the most expensive block in the suite and the one that carries the
 * most weight. Nothing else proves the sign-off is REACHABLE — a Battle whose
 * top checkpoint no play can satisfy would look identical, from every other test
 * here, to one that is merely hard. And nothing else can measure the product,
 * because both "stop the service" and "leave it open" only become distinguishable
 * once security is whole.
 */
describe("the event can be won, and only by holding both halves at once", () => {
  const ports = { challenge: 18394, verify: 18395 };
  const seed = "gameday-solve-seed";
  let app: Started;
  let artifact = "";

  const solved = {
    /** Every rule the desk's own ground truth allows, and nothing else. */
    desk: {
      enabled: true,
      readsPerRound: 200,
      rules: [
        { effect: "allow", actions: ["read"], actor: "*", resource: { ownerIs: "actor" } },
        { effect: "allow", actions: ["read"], actor: { role: "moderator" }, resource: "*" },
        {
          effect: "allow",
          actions: ["publish"],
          actor: { role: "moderator" },
          resource: { ownerIsNot: "actor" },
        },
      ],
    },
    relay: { archiveLogging: "on", healthCheckProbes: ["config", "archive"], logDetail: "safe" },
  };

  const writePosts = async (tag: string, count = 24) => {
    for (let index = 0; index < count; index += 1) {
      await post(ports.challenge, "/api/posts", { author: "sre", title: `${tag} ${index}`, body: "x" });
    }
  };

  beforeAll(async () => {
    // Slow enough that Stabilize does not arrive mid-solve; the assertions drive
    // the clock forward themselves once everything is green.
    app = start(checkout(), ports, { FLAG_SEED: seed, STACKSTACK_GAMEDAY_SCALE: "120" });
    expect(await waitForBoard(ports.challenge), app.stderr().slice(0, 400)).toBe(true);

    // Join.
    writeJson(app.scratch, "config/app.json", { boardTitle: "board", acceptingPosts: true });
    // Build: the one thing the inherited implementation gets wrong.
    writeFileSync(file(app.scratch, "feature/search.mjs"), fixedSearch(app.scratch));
    // Ship: a release that resolves the key by reference, and a tidy plane.
    artifact = String(
      ((await get(ports.challenge, "/shipyard/artifacts")).body as any).artifacts[0].id,
    );
    writeJson(app.scratch, "release/release.json", {
      artifact,
      env: {
        BOARD_PUBLIC_TITLE: "社内掲示板",
        BOARD_SIGNING_KEY: { fromSecret: "board-signing-key" },
      },
    });
    expect((await post(ports.challenge, "/shipyard/releases")).status).toBe(201);
    expect((await get(ports.challenge, "/site")).status).toBe(200);
    const plane = (await get(ports.challenge, "/shipyard/releases")).body as any;
    for (const release of plane.releases) {
      if (release.id === plane.live) continue;
      await fetch(`http://127.0.0.1:${ports.challenge}/shipyard/release?id=${release.id}`, {
        method: "DELETE",
      });
    }
    // Expose, including the surface the access document has to be right about
    // before it exists.
    writeJson(app.scratch, "access/access.json", INCIDENT_READY_POLICY);
    // Attack.
    writeJson(app.scratch, "policy/access.json", solved.desk);
    // Incident: the log on, redacted in the one way that keeps the investigation.
    writeJson(app.scratch, "relay/relay.json", solved.relay);
    await writePosts("solve");
    await get(ports.challenge, "/relay/healthz");
    // Stabilize: mint an ops key with the break-glass credential the container
    // prints to its own console, cut the nightly job over to it, then close the
    // published one.
    const breakGlass = /break-glass credential: ([0-9a-f]+)/.exec(app.stderr())?.[1] ?? "";
    expect(breakGlass, "break-glass credential was not on the container console").not.toBe("");
    const issued = await fetch(`http://127.0.0.1:${ports.challenge}/api/ops/keys`, {
      method: "POST",
      headers: { "x-break-glass": breakGlass },
    });
    expect(issued.status).toBe(201);
    const key = (await issued.json()) as { keyId: string };
    writeJson(app.scratch, "ops/ops.json", {
      identity: key.keyId,
      grants: ["board:count", "digest:publish"],
    });
    expect((await post(ports.challenge, "/api/ops/digest/run")).status).toBe(200);
    const revoked = await fetch(
      `http://127.0.0.1:${ports.challenge}/api/ops/keys/revoke?keyId=ops-legacy`,
      { method: "POST", headers: { "x-break-glass": breakGlass } },
    );
    expect(revoked.status).toBe(200);
    expect((await post(ports.challenge, "/api/ops/digest/run")).status).toBe(200);
    await writePosts("after", 8);
    await get(ports.challenge, "/relay/healthz");
  });
  afterAll(() => app?.process.kill());

  it("should reach a state where every security fact and every probe is green", async () => {
    const snapshot = await until(
      ports.challenge,
      (s) =>
        s.security.share === 1 &&
        s.availability.share === 1 &&
        s.availability.probes.every((probe: any) => probe.armed || probe.opensAt !== "join"),
      60_000,
    );
    expect(snapshot.security.facts).toEqual({
      "desk-authz": true,
      "portal-authn": true,
      "archive-scope": true,
      permissions: true,
      "log-hygiene": true,
      "release-binding": true,
    });
    expect(snapshot.availability.share).toBe(1);
    expect(snapshot.availability.withinBudget).toBe(true);
  });

  it("should score each tick as the product of the two halves, not their sum", async () => {
    // The measurement that gives the product teeth. Over a window where both
    // fractions are steady, the integral must advance at exactly A × S per tick.
    // Drop the availability term and it advances at S — which is what this
    // arithmetic detects and no gate assertion can.
    const before = await score(ports.challenge);
    await sleep(1_500);
    const after = await score(ports.challenge);
    const grew = after.integralMs - before.integralMs;
    const elapsed = after.scoredMs - before.scoredMs;
    expect(elapsed).toBeGreaterThan(0);
    expect(grew / elapsed).toBeCloseTo(after.availability * after.security, 2);
  });

  it("should hand out the sign-off only after both halves have held for the whole hold", async () => {
    const stillHeld = await until(ports.challenge, (s) => s.score.holdSatisfied === true, 60_000);
    expect(stillHeld.score.holdSatisfied).toBe(true);
    expect(stillHeld.score.heldForMs).toBeGreaterThanOrEqual(stillHeld.score.holdMs);

    const opened = await until(
      ports.challenge,
      (s) => s.event.schedule.stabilize.open === true && s.phases.every((p: any) => p.greenNow),
      90_000,
    );
    expect(opened.phases.every((phase: any) => phase.greenNow)).toBe(true);

    const signoff = await until(
      ports.challenge,
      (s) => s.score.holdSatisfied === true && s.event.schedule.stabilize.open === true,
      60_000,
    );
    expect(signoff.score.holdSatisfied).toBe(true);

    const measured = await posture(ports.challenge);
    expect(measured.gates.gameday_signoff).toBe(true);
    expect(measured.tokens.gameday_signoff).toMatch(/^TC\{gameday_signoff_[0-9a-f]{16}\}$/);
    expect(
      (await verify(ports, "signoff", String(measured.tokens.gameday_signoff))).correct,
    ).toBe(true);
    // ...and every phase checkpoint answers to its own receipt, which is what
    // makes the per-phase result ledger mean something.
    for (const phase of ["build", "ship", "expose", "attack", "incident", "stabilize"]) {
      const token = measured.tokens[`gameday_${phase}`];
      expect(token, phase).not.toBeNull();
      expect((await verify(ports, phase, String(token))).correct, phase).toBe(true);
    }
    expect((await verify(ports, "join", boardSerial(seed))).correct).toBe(true);
  });

  it("should reset the hold the instant availability is short, with security still whole", async () => {
    // The other half of the product, and the one no other test can reach: with
    // every security fact green, the hold must still stop the moment a committed
    // path goes away. If availability were dropped from the hold condition, this
    // would keep running through the outage.
    //
    // The outage has to be one that costs availability and NOTHING else, or the
    // control below is not a control. Breaking search — the obvious lever, and
    // the one tried first — is not: `archive-scope` is `vibe-build`'s
    // `drafts_withheld`, which is measured THROUGH search, so a thrown search
    // takes a security fact down with it and the assertion becomes untestable
    // rather than false.
    //
    // Dropping the two incident rules is clean. The incident page is a committed
    // path from the Incident phase onward, so the `monitor` probe goes red; and
    // no security fact reads it, because `portal-authn` is `admin_sealed` and
    // `drafts_scoped`, both of which the remaining rules still satisfy.
    writeJson(app.scratch, "access/access.json", EXPOSE_SOLVED_POLICY);
    const degraded = await until(
      ports.challenge,
      (s) => s.availability.share < 1,
      30_000,
    );
    expect(degraded.availability.share).toBeLessThan(1);
    expect(degraded.security.share).toBe(1);
    const live = await score(ports.challenge);
    expect(live.security).toBe(1);
    expect(live.availability).toBeLessThan(1);
    expect(live.heldForMs).toBe(0);
    expect(live.holdSatisfied).toBe(false);
    expect((await posture(ports.challenge)).gates.gameday_signoff).toBe(false);
  });
});

describe("the starter files the problem ships", () => {
  it("should be one diagnosis and one edit from correct in each phase", () => {
    // The 90-minute estimate rests entirely on this. If a starter drifts back to
    // an empty stub, the event stops fitting and nothing else would say so.
    const scratch = checkout();
    const search = readFileSync(file(scratch, "feature/search.mjs"), "utf8");
    expect(search).toContain("q_required");
    expect(search).toContain("q_too_long");
    expect(search).not.toContain('visibility === "public"');

    // The release ships the predecessor's artifact id and no signing key, so the
    // participant has to look up what actually exists.
    const release = readJsonFile(scratch, "release/release.json");
    expect((release.env as Record<string, unknown>).BOARD_SIGNING_KEY).toBeUndefined();

    // Every other starter loads and is permissive, so nothing is blocked on a
    // parse error the participant did not cause.
    expect(readJsonFile(scratch, "access/access.json").defaultEffect).toBe("allow");
    expect(readJsonFile(scratch, "relay/relay.json").archiveLogging).toBe("off");
    expect(readJsonFile(scratch, "ops/ops.json").grants).toEqual(["*"]);
    expect(readJsonFile(scratch, "config/app.json").acceptingPosts).toBe(false);
  });
});
