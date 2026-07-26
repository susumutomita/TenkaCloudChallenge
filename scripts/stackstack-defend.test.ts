import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-defend grades a defence, so the only assertions worth writing are
 * the ones that would fail if the defence were faked.
 *
 * Three shapes of test carry the weight here, and each exists because the
 * catalog has shipped its absence before:
 *
 *  1. **The attack really works on the untouched starter.** If it does not, the
 *     whole problem is a fiction and every later assertion is about nothing.
 *  2. **No checkpoint passes vacuously.** Every checkpoint is asserted false in
 *     the starting state, and every checkpoint that grades an *absence* is
 *     asserted false in the state where the absence is achieved by breaking the
 *     service — "deny everything" produces zero attacks getting through, and it
 *     must be worth zero points.
 *  3. **The earned value is refused in a state where it has not been earned.**
 *     For every checkpoint, the real answer is harvested out of the running app
 *     at a moment when it must not be accepted, and submitted. Wrong guesses
 *     failing only proves that guessing fails; it does not pin the checkpoint to
 *     the work. A one-line regression that stamped the earned value onto the
 *     failure path would pass a suite full of garbage-string negatives.
 *
 * Everything runs under Bun against the real app over real HTTP. No Docker, no
 * AWS, no cloud account: the drill this problem is built around is a traffic
 * generator inside the same process, so a suite that drives the listener drives
 * exactly what a participant's container does.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-defend");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "defend.mjs");

/** Ports reserved for this problem's suite alone. */
const PORT = 18350;
const VERIFY_PORT = 18351;
const FRESH_PORT = 18352;
const FRESH_VERIFY_PORT = 18353;

const BOARD = `http://127.0.0.1:${PORT}`;
const VERIFY = `http://127.0.0.1:${VERIFY_PORT}/verify`;
const SEED = "stackstack-defend-test-seed";

/**
 * The drill's three knobs, turned down so a suite runs in seconds.
 *
 * They change how long the wait is, never what is required: a window still has
 * to be entirely clean and the hold still has to survive every round in it. The
 * READMEs name all three, so this is a documented shortcut rather than a hidden
 * one.
 */
const INTERVAL_MS = 10;
const WINDOW_ROUNDS = 4;
const HOLD_MS = 200;

const CONFIG_HINT = "problems/challenges/stackstack-defend/local/config/app.json";
const POLICY_HINT = "problems/challenges/stackstack-defend/local/policy/access.json";

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
  readonly runtime: { readonly challengeEndpoints: Record<string, string>; readonly verifyUrl: string };
}

const metadata = JSON.parse(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")) as Metadata;
const STARTER_POLICY = JSON.parse(
  readFileSync(join(PROBLEM_DIR, "local", "policy", "access.json"), "utf8"),
) as Record<string, unknown>;

/** The policy a participant who solves the problem ends up with. */
const CORRECT_POLICY = {
  enabled: true,
  readsPerRound: 200,
  rules: [
    { effect: "allow", actions: ["read"], actor: "*", resource: { ownerIs: "actor" } },
    { effect: "allow", actions: ["read"], actor: { role: "moderator" }, resource: "*" },
    { effect: "allow", actions: ["publish"], actor: { role: "moderator" }, resource: { ownerIsNot: "actor" } },
  ],
};

let scratch = "";
let policyPath = "";
let configPath = "";
let freshPolicyPath = "";
let server: ReturnType<typeof spawn>;
/**
 * A second instance, never exploited by the main block's traffic.
 *
 * The exploit latch is deliberately one-way — once a forbidden read has handed
 * over the marker, that fact can never be un-done — so the "the real marker is
 * refused before it has been earned" assertions need an instance that has not
 * been through it. Started here rather than in a nested `beforeAll`, because a
 * nested one would run after the block that uses it.
 */
let freshInstance: ReturnType<typeof spawn>;
const FRESH = `http://127.0.0.1:${FRESH_PORT}`;
const FRESH_VERIFY = `http://127.0.0.1:${FRESH_VERIFY_PORT}/verify`;

function writePolicy(policy: unknown): void {
  writeFileSync(policyPath, JSON.stringify(policy, null, 2));
}

function writePolicyText(text: string): void {
  writeFileSync(policyPath, text);
}

function startServer(options: {
  challengePort: number;
  verifyPort: number;
  policy: string;
  config: string;
}): ReturnType<typeof spawn> {
  return spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "defend",
      FLAG_SEED: SEED,
      APP_CONFIG: options.config,
      ACCESS_POLICY: options.policy,
      CONFIG_HINT,
      POLICY_HINT,
      CHALLENGE_PORT: String(options.challengePort),
      VERIFY_PORT: String(options.verifyPort),
      DEFEND_INTERVAL_MS: String(INTERVAL_MS),
      DEFEND_WINDOW_ROUNDS: String(WINDOW_ROUNDS),
      DEFEND_HOLD_MS: String(HOLD_MS),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForListener(port: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status < 600) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`nothing came up on :${port}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function get(path: string, base = BOARD, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { headers });
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

async function asActor(
  method: string,
  path: string,
  token: string,
  base = BOARD,
  payload?: unknown,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

async function verifyCheckpoint(checkpointId: string, submission: string, url = VERIFY) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkpointId, submission, context: { teamId: "t", problemId: "p" } }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const drill = async (base = BOARD) => (await get("/api/drill", base)).body;
const postureOf = async (base = BOARD) => (await get("/posture", base)).body;

/** Wait until the rolling window contains no rounds measured under the previous policy. */
async function flushWindow(base = BOARD): Promise<void> {
  const start = (await drill(base)).roundsCompleted as number;
  const deadline = Date.now() + 20_000;
  for (;;) {
    const now = (await drill(base)).roundsCompleted as number;
    if (now >= start + WINDOW_ROUNDS + 2) return;
    if (Date.now() > deadline) throw new Error("the drill stopped advancing");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitUntil(
  predicate: (state: any) => boolean,
  label: string,
  base = BOARD,
  timeoutMs = 20_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await postureOf(base);
    if (predicate(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(`${label}: gave up with gates ${JSON.stringify(state.gates)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Apply a policy, let the window turn over, and return the posture that resulted. */
async function applyAndSettle(policy: unknown, base = BOARD): Promise<any> {
  writePolicy(policy);
  await flushWindow(base);
  return postureOf(base);
}

const greenPolicy = () => JSON.parse(JSON.stringify(CORRECT_POLICY)) as typeof CORRECT_POLICY;

async function goGreen(base = BOARD): Promise<any> {
  writePolicy(greenPolicy());
  await flushWindow(base);
  return waitUntil((state) => state.ready === true, "never reached a green posture", base);
}

/** The tokens the desk hands out, read the way a participant reads them. */
async function tokensFromDesk(base = BOARD): Promise<Record<string, string>> {
  const page = await get("/desk", base);
  const found: Record<string, string> = {};
  for (const actor of ["u-guest", "u-editor", "u-mod"]) {
    const match = new RegExp(
      `<code>${actor}</code></td><td>[^<]*</td><td>[^<]*</td><td><code>([0-9a-f]+)</code>`,
    ).exec(page.text);
    if (match !== null) found[actor] = match[1] as string;
  }
  return found;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-defend-"));
  policyPath = join(scratch, "access.json");
  configPath = join(scratch, "app.json");
  writeFileSync(configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));
  writePolicy(STARTER_POLICY);

  freshPolicyPath = join(scratch, "fresh-access.json");
  writeFileSync(freshPolicyPath, JSON.stringify(STARTER_POLICY, null, 2));

  server = startServer({
    challengePort: PORT,
    verifyPort: VERIFY_PORT,
    policy: policyPath,
    config: configPath,
  });
  freshInstance = startServer({
    challengePort: FRESH_PORT,
    verifyPort: FRESH_VERIFY_PORT,
    policy: freshPolicyPath,
    config: configPath,
  });
  await waitForListener(PORT);
  await waitForListener(FRESH_PORT);
});

afterAll(() => {
  server?.kill();
  freshInstance?.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("stackstack-defend scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
    expect(metadata.scoring.kind).toBe("multi-verify");
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(200);
  });

  it("should spend the Medium tier's whole wrong-answer budget and no more", () => {
    // The validator only enforces this for a flat `points`, so for multi-verify
    // nothing checks it but this line.
    const spent = metadata.scoring.checks.reduce(
      (sum, check) => sum + (check.wrongAnswerPenalty ?? 0),
      0,
    );
    expect(spent).toBe(10);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty ?? 0).toBeLessThanOrEqual(check.points);
    }
  });

  it("should charge a wrong answer only where a wrong answer is a guess", () => {
    // Four of the five checkpoints are answered with a receipt the app withholds
    // until it is earned, and polling until it appears is the intended loop.
    // Charging for that would bill a participant for doing what the problem asks.
    const byId = new Map(metadata.scoring.checks.map((check) => [check.id, check]));
    expect(byId.get("read-the-leak")?.wrongAnswerPenalty).toBe(10);
    for (const id of ["stop-the-leak", "keep-serving", "close-the-write-path", "signoff"]) {
      expect(byId.get(id)?.wrongAnswerPenalty ?? 0).toBe(0);
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

  it("should give every hint in the problem a unique id", () => {
    const ids = metadata.scoring.checks.flatMap((check) => (check.hints ?? []).map((h) => h.id));
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

  it("should keep player-visible strings free of the vulnerability class", () => {
    // AGENT.md §10 / §13: labels and hints name the symptom or the asset. They
    // must not hand over the finding, and the hints must not print the answer.
    const visible = [
      ...metadata.scoring.checks.map((check) => check.label),
      ...metadata.i18n.en.checks.map((check) => check.label),
      ...metadata.scoring.checks.flatMap((check) => (check.hints ?? []).map((h) => JSON.stringify(h))),
      ...metadata.i18n.en.checks.flatMap((check) => (check.hints ?? []).map((h) => JSON.stringify(h))),
    ].join("\n");
    for (const banned of ["IDOR", "BOLA", "認可不備", "broken access control", "privilege escalation"]) {
      expect(visible.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    // ...and no hint spells out the rule the participant is graded on writing.
    for (const answer of ["ownerIs", "ownerIsNot", '"role": "moderator"', "role\\\":\\\"moderator"]) {
      expect(visible).not.toContain(answer);
    }
  });
});

describe("stackstack-defend wiring", () => {
  const composeDir = join(PROBLEM_DIR, "local");
  const compose = parseYaml(readFileSync(join(composeDir, "docker-compose.yml"), "utf8")) as {
    services: Record<
      string,
      {
        build: { context: string; dockerfile: string };
        environment: Record<string, string>;
        volumes: string[];
        ports: string[];
      }
    >;
  };
  const service = Object.values(compose.services)[0] as (typeof compose.services)[string];

  it("should publish every port on loopback only, and declare exactly those ports", () => {
    for (const url of Object.values(metadata.runtime.challengeEndpoints)) {
      expect(service.ports).toContain(`127.0.0.1:${new URL(url).port}:8080`);
    }
    expect(service.ports).toContain(`127.0.0.1:${new URL(metadata.runtime.verifyUrl).port}:8081`);
    for (const published of service.ports) expect(published.startsWith("127.0.0.1:")).toBe(true);
    const published = service.ports.map((entry) => Number(entry.split(":")[1])).sort((a, b) => a - b);
    expect(metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b)).toEqual(published);
  });

  it("should build the shared base image and select the scenario metadata's handlers live in", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    expect(existsSync(join(composeDir, service.build.context, service.build.dockerfile))).toBe(true);
    expect(service.environment.SCENARIO).toBe("defend");
    expect(existsSync(SCENARIO_FILE)).toBe(true);
  });

  it("should mount both participant-owned directories read-only", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro", "./policy:/app/policy:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "policy", "access.json"))).toBe(true);
  });

  it("should name both files by the path in the participant's checkout", () => {
    // `make local` runs from the platform repository, where this catalog is the
    // `problems/` submodule. The app itself only ever sees /app/..., which is a
    // path that does not exist on their machine.
    expect(service.environment.CONFIG_HINT).toBe(CONFIG_HINT);
    expect(service.environment.POLICY_HINT).toBe(POLICY_HINT);
    for (const relative of [CONFIG_HINT, POLICY_HINT]) {
      expect(existsSync(join(REPO_ROOT, relative.replace(/^problems\//, "")))).toBe(true);
    }
    for (const name of ["README.md", "README.ja.md"]) {
      expect(readFileSync(join(PROBLEM_DIR, name), "utf8")).toContain(POLICY_HINT);
    }
    expect(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")).toContain(POLICY_HINT);
  });

  it("should ship a starter policy that is genuinely open", () => {
    // Shipping an already-fixed starter is the accident that silently turns this
    // problem into a no-op, and nothing else in CI would notice.
    const rules = (STARTER_POLICY.rules ?? []) as any[];
    const catchAll = rules.some(
      (rule) =>
        rule.effect === "allow" &&
        rule.actor === "*" &&
        rule.resource === "*" &&
        rule.actions.includes("read") &&
        rule.actions.includes("publish"),
    );
    expect(catchAll).toBe(true);
    expect(STARTER_POLICY.enabled).toBe(true);
  });

  it("should declare a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await verifyCheckpoint(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    // The other direction: a handler with no checkpoint behind it is dead code.
    const source = readFileSync(SCENARIO_FILE, "utf8");
    const block = /export const checks = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
    expect(block).not.toBe("");
    const handlers = [...block.matchAll(/^ {2}"?([a-z][a-z0-9-]*)"?:/gm)].map((m) => m[1] as string);
    expect(handlers.sort()).toEqual(metadata.scoring.checks.map((check) => check.id).sort());
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-defend: the attack really works on the untouched starter", () => {
  let tokens: Record<string, string> = {};

  it("should hand the investigation account's token to anyone who opens the desk", async () => {
    tokens = await tokensFromDesk();
    expect(tokens["u-guest"]).toMatch(/^[0-9a-f]{24}$/);
    expect(tokens["u-editor"]).toMatch(/^[0-9a-f]{24}$/);
    expect(tokens["u-mod"]).toMatch(/^[0-9a-f]{24}$/);
  });

  it("should never print the owner's token anywhere the participant can reach", async () => {
    // The one account whose token is withheld is the reason "read it as somebody
    // who may not" has to be done rather than looked up.
    //
    // Rather than trusting the desk's wording: harvest every 24-hex string this
    // container serves on any surface, and try each one as a credential. If any
    // of them authenticates as the owner, the withholding is a fiction.
    const surfaces = ["/desk", "/", "/api/board", "/api/logs?limit=500", "/api/policy", "/api/drill", "/posture"];
    const seen = (await Promise.all(surfaces.map((path) => get(path)))).map((r) => r.text).join("\n");
    const candidates = new Set([...seen.matchAll(/[0-9a-f]{24}/g)].map((match) => match[0]));
    expect(candidates.size).toBeGreaterThanOrEqual(3);
    for (const candidate of candidates) {
      const who = await asActor("GET", "/api/drafts", candidate);
      if (who.status === 200) expect(who.body.actor.id).not.toBe("u-cto");
    }
    expect((await get("/desk")).text).toContain("この端末には配られていません");
  });

  it("should let the guest account list drafts it did not write", async () => {
    const listed = await asActor("GET", "/api/drafts", tokens["u-guest"] as string);
    expect(listed.status).toBe(200);
    const owners = new Set(listed.body.drafts.map((draft: { ownerId: string }) => draft.ownerId));
    expect(owners.size).toBeGreaterThan(1);
    expect(owners.has("u-cto")).toBe(true);
  });

  it("should hand the guest account a draft body it must never see", async () => {
    const listed = await asActor("GET", "/api/drafts", tokens["u-guest"] as string);
    const target = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-cto");
    const read = await asActor("GET", `/api/draft?id=${target.id}`, tokens["u-guest"] as string);
    expect(read.status).toBe(200);
    expect(read.body.body).toMatch(/TC\{leak_[0-9a-f]{32}\}/);
  });

  it("should let a non-moderator publish somebody else's draft", async () => {
    const listed = await asActor("GET", "/api/drafts", tokens["u-guest"] as string);
    const target = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-editor");
    const publishOne = await asActor("POST", `/api/publish?id=${target.id}`, tokens["u-guest"] as string);
    expect(publishOne.status).toBe(201);
  });

  it("should let the moderator break the four-eyes rule on their own draft", async () => {
    const listed = await asActor("GET", "/api/drafts", tokens["u-mod"] as string);
    const own = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-mod");
    const publishOwn = await asActor("POST", `/api/publish?id=${own.id}`, tokens["u-mod"] as string);
    expect(publishOwn.status).toBe(201);
  });

  it("should refuse a request with no credential at all", async () => {
    expect((await get("/api/drafts")).status).toBe(401);
    expect((await asActor("GET", "/api/drafts", "not-a-token")).status).toBe(401);
  });

  it("should measure the starter as broken on every gate that matters", async () => {
    await flushWindow();
    const state = await postureOf();
    expect(state.gates.policy_loaded).toBe(true);
    // The listings exceed every entitled set, so the *positive* gate is already
    // false before anything is deliberately broken. That is what stops the
    // service checkpoint from being free on an untouched starter.
    expect(state.gates.service_intact).toBe(false);
    expect(state.gates.reads_held).toBe(false);
    expect(state.gates.publishes_held).toBe(false);
    expect(state.gates.held_under_load).toBe(false);
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
    const measured = await drill();
    expect(measured.window.attack.read.leaked).toBeGreaterThan(0);
    expect(measured.window.attack.publish.leaked).toBeGreaterThan(0);
  }, 30_000);

  it("should withhold every receipt and refuse every checkpoint on the starter", async () => {
    const state = await postureOf();
    for (const gate of ["service_intact", "reads_held", "publishes_held", "held_under_load"]) {
      expect(state.tokens[gate]).toBeNull();
    }
    for (const check of metadata.scoring.checks) {
      expect((await verifyCheckpoint(check.id, "anything")).body.correct).toBe(false);
    }
  });
});

describe("stackstack-defend: read-the-leak is earned, not computed", () => {
  let marker = "";

  it("should start the fresh instance un-exploited, with every measured gate red", async () => {
    await flushWindow(FRESH);
    const state = await postureOf(FRESH);
    expect(state.gates.policy_loaded).toBe(true);
    expect(state.gates.service_intact).toBe(false);
    expect(state.gates.reads_held).toBe(false);
    expect(state.gates.publishes_held).toBe(false);
    expect(state.gates.held_under_load).toBe(false);
    expect(state.readyToken).toBeNull();
  }, 30_000);

  it("should not count reading the marker as the account that is allowed to", async () => {
    // The whole point. `u-mod` may read every draft, so its read is not the
    // attack — and the marker it returns is the real, correct answer string.
    // Submitting it here must be refused, or the checkpoint is a digest anyone
    // can compute from FLAG_SEED without ever touching the application.
    const tokens = await tokensFromDesk(FRESH);
    const listed = await asActor("GET", "/api/drafts", tokens["u-mod"] as string, FRESH);
    const target = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-cto");
    const read = await asActor("GET", `/api/draft?id=${target.id}`, tokens["u-mod"] as string, FRESH);
    expect(read.status).toBe(200);
    marker = /TC\{leak_[0-9a-f]{32}\}/.exec(read.body.body)?.[0] as string;
    expect(marker).toMatch(/^TC\{leak_[0-9a-f]{32}\}$/);

    expect((await verifyCheckpoint("read-the-leak", marker, FRESH_VERIFY)).body.correct).toBe(false);
  });

  it("should not count the drill's own traffic as the participant's reproduction", async () => {
    // The drill reads that same draft as the guest account every single round.
    // If its traffic set the latch, the container would be answering this
    // checkpoint on the participant's behalf within a second of boot.
    const measured = await drill(FRESH);
    expect(measured.window.attack.read.leaked).toBeGreaterThan(0);
    expect((await verifyCheckpoint("read-the-leak", marker, FRESH_VERIFY)).body.correct).toBe(false);
  });

  it("should not count a forbidden read of some other draft", async () => {
    // A forbidden read that does not hand over the thing that matters is not the
    // incident: the latch is about this body, not about any 403 turning into a
    // 200 somewhere.
    const tokens = await tokensFromDesk(FRESH);
    const listed = await asActor("GET", "/api/drafts", tokens["u-guest"] as string, FRESH);
    const other = listed.body.drafts.find(
      (draft: { ownerId: string }) => draft.ownerId === "u-editor",
    );
    expect((await asActor("GET", `/api/draft?id=${other.id}`, tokens["u-guest"] as string, FRESH)).status).toBe(200);
    expect((await verifyCheckpoint("read-the-leak", marker, FRESH_VERIFY)).body.correct).toBe(false);
  });

  it("should accept the marker once a forbidden read has actually returned it", async () => {
    const tokens = await tokensFromDesk(FRESH);
    const listed = await asActor("GET", "/api/drafts", tokens["u-guest"] as string, FRESH);
    const target = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-cto");
    const read = await asActor("GET", `/api/draft?id=${target.id}`, tokens["u-guest"] as string, FRESH);
    expect(read.status).toBe(200);
    expect(/TC\{leak_[0-9a-f]{32}\}/.exec(read.body.body)?.[0]).toBe(marker);
    expect((await verifyCheckpoint("read-the-leak", marker, FRESH_VERIFY)).body.correct).toBe(true);
    expect((await verifyCheckpoint("read-the-leak", ` ${marker} `, FRESH_VERIFY)).body.correct).toBe(true);
  });

  it("should reject anything that is not exactly the marker", async () => {
    for (const wrong of [
      "",
      " ",
      marker.slice(0, -1),
      `${marker}x`,
      marker.replace("leak", "leek"),
      "TC{leak_00000000000000000000000000000000}",
    ]) {
      expect((await verifyCheckpoint("read-the-leak", wrong, FRESH_VERIFY)).body.correct).toBe(false);
    }
    // ...and the right one still passes, so the assertions above are not merely
    // observing a checkpoint that refuses everything.
    expect((await verifyCheckpoint("read-the-leak", marker, FRESH_VERIFY)).body.correct).toBe(true);
  });

  it("should stay earned after the board is fixed", async () => {
    // Reproduce-then-fix is the natural incident order, but a participant who
    // fixed first and reproduced after must not lose what they already saw — and
    // the latch must not be re-openable either way.
    writeFileSync(freshPolicyPath, JSON.stringify(CORRECT_POLICY, null, 2));
    await flushWindow(FRESH);
    const tokens = await tokensFromDesk(FRESH);
    const listed = await asActor("GET", "/api/drafts", tokens["u-mod"] as string, FRESH);
    const target = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-cto");
    expect((await asActor("GET", `/api/draft?id=${target.id}`, tokens["u-guest"] as string, FRESH)).status).toBe(403);
    expect((await verifyCheckpoint("read-the-leak", marker, FRESH_VERIFY)).body.correct).toBe(true);
  }, 30_000);
});

describe("stackstack-defend: the fix", () => {
  const receipts: Record<string, string> = {};
  let readyToken = "";

  it("should turn every gate green once the policy describes the rule", async () => {
    const state = await goGreen();
    expect(state.gates).toEqual({
      policy_loaded: true,
      service_intact: true,
      reads_held: true,
      publishes_held: true,
      held_under_load: true,
    });
    expect(state.readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
    for (const gate of ["service_intact", "reads_held", "publishes_held"]) {
      expect(state.tokens[gate]).toMatch(/^TC\{[a-z_]+_[0-9a-f]{16}\}$/);
      receipts[gate] = state.tokens[gate] as string;
    }
    readyToken = state.readyToken as string;
  }, 40_000);

  it("should refuse the fixed board's forbidden reads with the policy, not an outage", async () => {
    const tokens = await tokensFromDesk();
    const listed = await asActor("GET", "/api/drafts", tokens["u-mod"] as string);
    const notMine = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-cto");
    const denied = await asActor("GET", `/api/draft?id=${notMine.id}`, tokens["u-guest"] as string);
    expect(denied.status).toBe(403);
    // ...while the owner and the moderator still get it.
    expect((await asActor("GET", `/api/draft?id=${notMine.id}`, tokens["u-mod"] as string)).status).toBe(200);
  });

  it("should keep the moderator publishing and refuse the four-eyes violation", async () => {
    const tokens = await tokensFromDesk();
    const listed = await asActor("GET", "/api/drafts", tokens["u-mod"] as string);
    const other = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId !== "u-mod");
    const own = listed.body.drafts.find((draft: { ownerId: string }) => draft.ownerId === "u-mod");
    expect((await asActor("POST", `/api/publish?id=${other.id}`, tokens["u-mod"] as string)).status).toBe(201);
    expect((await asActor("POST", `/api/publish?id=${own.id}`, tokens["u-mod"] as string)).status).toBe(403);
    expect((await asActor("POST", `/api/publish?id=${other.id}`, tokens["u-guest"] as string)).status).toBe(403);
  });

  it("should credit every checkpoint for the receipt the app actually emitted", async () => {
    await waitUntil((state) => state.ready === true, "lost the green state");
    expect((await verifyCheckpoint("stop-the-leak", receipts.reads_held as string)).body.correct).toBe(true);
    expect((await verifyCheckpoint("keep-serving", receipts.service_intact as string)).body.correct).toBe(true);
    expect(
      (await verifyCheckpoint("close-the-write-path", receipts.publishes_held as string)).body.correct,
    ).toBe(true);
    expect((await verifyCheckpoint("signoff", readyToken)).body.correct).toBe(true);
  }, 30_000);

  it("should refuse another checkpoint's receipt, however real that receipt is", async () => {
    // Every one of these values was emitted by this app, right now, and is the
    // correct answer to a different checkpoint.
    const pairs: [string, string][] = [
      ["stop-the-leak", receipts.service_intact as string],
      ["stop-the-leak", readyToken],
      ["keep-serving", receipts.reads_held as string],
      ["close-the-write-path", receipts.reads_held as string],
      ["signoff", receipts.publishes_held as string],
    ];
    for (const [checkpoint, submission] of pairs) {
      expect((await verifyCheckpoint(checkpoint, submission)).body.correct).toBe(false);
    }
  });

  it("should reject an empty, truncated or extended submission on every receipt checkpoint", async () => {
    const answers: Record<string, string> = {
      "stop-the-leak": receipts.reads_held as string,
      "keep-serving": receipts.service_intact as string,
      "close-the-write-path": receipts.publishes_held as string,
      signoff: readyToken,
    };
    for (const [checkpoint, right] of Object.entries(answers)) {
      expect((await verifyCheckpoint(checkpoint, "")).body.correct).toBe(false);
      expect((await verifyCheckpoint(checkpoint, " ")).body.correct).toBe(false);
      expect((await verifyCheckpoint(checkpoint, right.slice(0, -1))).body.correct).toBe(false);
      expect((await verifyCheckpoint(checkpoint, `${right}x`)).body.correct).toBe(false);
      expect((await verifyCheckpoint(checkpoint, right)).body.correct).toBe(true);
    }
  });

  it("should take every receipt back the moment the fix is reverted", async () => {
    // The receipts are stable for the life of the process, so a participant who
    // saw them once must not keep the credit after breaking the board again.
    await applyAndSettle(STARTER_POLICY);
    const reverted = await postureOf();
    expect(reverted.gates.reads_held).toBe(false);
    expect(reverted.gates.service_intact).toBe(false);
    expect(reverted.readyToken).toBeNull();
    for (const [checkpoint, submission] of [
      ["stop-the-leak", receipts.reads_held],
      ["keep-serving", receipts.service_intact],
      ["close-the-write-path", receipts.publishes_held],
      ["signoff", readyToken],
    ] as [string, string][]) {
      expect((await verifyCheckpoint(checkpoint, submission)).body.correct).toBe(false);
    }
    await goGreen();
  }, 60_000);

  it("should reset the hold after a single bad round and withhold the sign-off again", async () => {
    const before = await postureOf();
    expect(before.gates.held_under_load).toBe(true);
    // One round of the open policy is enough: the hold counts consecutive good
    // rounds, so it goes to zero and has to be earned back from scratch.
    writePolicy(STARTER_POLICY);
    await waitUntil((state) => state.gates.held_under_load === false, "the hold never reset");
    expect((await drill()).cleanForMs).toBe(0);
    expect((await postureOf()).readyToken).toBeNull();
    await goGreen();
  }, 60_000);
});

describe("stackstack-defend: the cheap answers are worth nothing", () => {
  const harvested: Record<string, string> = {};

  it("should give deny-everything the attack gates and none of the points", async () => {
    // This is the load-bearing non-vacuity test. With every rule removed the
    // policy defaults to deny, so nothing forbidden gets through and BOTH attack
    // gates go green — the app really does emit their receipts. The checkpoints
    // must still refuse them, because the service is on the floor.
    const state = await applyAndSettle({ enabled: true, readsPerRound: 200, rules: [] });
    expect(state.gates.reads_held).toBe(true);
    expect(state.gates.publishes_held).toBe(true);
    expect(state.gates.service_intact).toBe(false);
    expect(state.ready).toBe(false);

    harvested.reads_held = state.tokens.reads_held as string;
    harvested.publishes_held = state.tokens.publishes_held as string;
    expect(harvested.reads_held).toMatch(/^TC\{reads_held_[0-9a-f]{16}\}$/);
    expect(harvested.publishes_held).toMatch(/^TC\{publishes_held_[0-9a-f]{16}\}$/);

    // The real, current, app-emitted receipts — submitted in the one state where
    // they must not be worth anything.
    expect((await verifyCheckpoint("stop-the-leak", harvested.reads_held)).body.correct).toBe(false);
    expect(
      (await verifyCheckpoint("close-the-write-path", harvested.publishes_held)).body.correct,
    ).toBe(false);
    expect((await verifyCheckpoint("keep-serving", "anything")).body.correct).toBe(false);
  }, 60_000);

  it("should count the same receipts once the service is back", async () => {
    // ...and the refusal above was about the service being down, not about the
    // receipts being wrong: the identical strings pass once the board works.
    const state = await goGreen();
    expect(state.tokens.reads_held).toBe(harvested.reads_held);
    expect((await verifyCheckpoint("stop-the-leak", harvested.reads_held)).body.correct).toBe(true);
    expect(
      (await verifyCheckpoint("close-the-write-path", harvested.publishes_held)).body.correct,
    ).toBe(true);
  }, 60_000);

  it("should not let closing the publish path for everybody count as closing it", async () => {
    // The narrower sibling of deny-everything, and the one a participant is most
    // likely to reach for after reading "close the publish path": leave reads
    // correct and refuse every publish. Nothing forbidden gets published — and
    // neither does anything permitted, so the approvals queue has simply stopped.
    const state = await applyAndSettle({
      enabled: true,
      readsPerRound: 200,
      rules: greenPolicy().rules.filter((rule) => !rule.actions.includes("publish")),
    });
    expect(state.gates.reads_held).toBe(true);
    expect(state.gates.publishes_held).toBe(true);
    expect(state.gates.service_intact).toBe(false);
    expect(state.ready).toBe(false);

    // The receipt for "no forbidden publish got through" is real and is being
    // emitted right now. It must still buy nothing.
    const receipt = state.tokens.publishes_held as string;
    expect(receipt).toMatch(/^TC\{publishes_held_[0-9a-f]{16}\}$/);
    expect((await verifyCheckpoint("close-the-write-path", receipt)).body.correct).toBe(false);
    expect((await verifyCheckpoint("keep-serving", "anything")).body.correct).toBe(false);

    const measured = await drill();
    expect(measured.window.normal.publishTotal).toBeGreaterThan(0);
    expect(measured.window.normal.publishServed).toBe(0);
  }, 60_000);

  it("should not let switching the feature off count as holding the attack", async () => {
    const state = await applyAndSettle({ ...greenPolicy(), enabled: false });
    const measured = await drill();
    expect(measured.window.attack.read.broken).toBeGreaterThan(0);
    expect(measured.window.attack.read.heldByPolicy).toBe(0);
    expect(state.gates.reads_held).toBe(false);
    expect(state.gates.publishes_held).toBe(false);
    expect(state.gates.service_intact).toBe(false);
    // The policy itself is fine — this is a deliberate choice, not a broken file.
    expect(state.gates.policy_loaded).toBe(true);
    for (const check of metadata.scoring.checks.filter((c) => c.id !== "read-the-leak")) {
      expect((await verifyCheckpoint(check.id, "anything")).body.correct).toBe(false);
    }
  }, 60_000);

  it("should not let a throttle count as holding the attack", async () => {
    const state = await applyAndSettle({ ...greenPolicy(), readsPerRound: 1 });
    const measured = await drill();
    expect(measured.window.attack.read.broken).toBeGreaterThan(0);
    expect(state.gates.reads_held).toBe(false);
    // The busier legitimate traffic hits the limit first, so this is not even a
    // trade — it costs the service before it costs the attacker.
    expect(state.gates.service_intact).toBe(false);
    expect((await verifyCheckpoint("stop-the-leak", "anything")).body.correct).toBe(false);
  }, 60_000);

  it("should refuse a harvested service receipt once the service is throttled", async () => {
    const green = await goGreen();
    const serviceReceipt = green.tokens.service_intact as string;
    expect((await verifyCheckpoint("keep-serving", serviceReceipt)).body.correct).toBe(true);
    await applyAndSettle({ ...greenPolicy(), readsPerRound: 1 });
    expect((await postureOf()).tokens.service_intact).toBeNull();
    expect((await verifyCheckpoint("keep-serving", serviceReceipt)).body.correct).toBe(false);
  }, 60_000);

  it("should not let blocking the account by name pass as a fix", async () => {
    const state = await applyAndSettle({
      ...greenPolicy(),
      rules: [
        { effect: "deny", actions: ["read", "publish"], actor: { id: "u-guest" }, resource: "*" },
        ...greenPolicy().rules,
      ],
    });
    // The attack gates can be green — the correct rules are still underneath —
    // but the blocked account is also a legitimate reader of its own draft.
    expect(state.gates.service_intact).toBe(false);
    expect(state.ready).toBe(false);
    const measured = await drill();
    expect(
      measured.lastFailures.some((entry: { why: string }) => entry.why.includes("u-guest")),
    ).toBe(true);
    expect((await verifyCheckpoint("keep-serving", "anything")).body.correct).toBe(false);
    expect((await verifyCheckpoint("stop-the-leak", state.tokens.reads_held ?? "x")).body.correct).toBe(
      false,
    );
  }, 60_000);

  it("should not let a table of the ids that exist right now stay correct", async () => {
    // Enumerate the entire current id space — which the starter hands over in one
    // request — and write the exhaustive allow-list a burned-in answer would be.
    const tokens = await tokensFromDesk();
    const all = (await asActor("GET", "/api/drafts", tokens["u-mod"] as string)).body.drafts as {
      id: string;
      ownerId: string;
    }[];
    expect(all.length).toBeGreaterThan(3);
    const burned = {
      enabled: true,
      readsPerRound: 200,
      rules: [
        ...all.map((draft) => ({
          effect: "allow",
          actions: ["read"],
          actor: { id: draft.ownerId },
          resource: { id: draft.id },
        })),
        { effect: "allow", actions: ["read"], actor: { role: "moderator" }, resource: "*" },
        {
          effect: "allow",
          actions: ["publish"],
          actor: { role: "moderator" },
          resource: { ownerIsNot: "actor" },
        },
      ],
    };
    writePolicy(burned);

    // First pin the mechanism, not just the consequence: wait for the board to
    // contain an id that did not exist when the table was written. Without this
    // step the assertion below would be satisfied by rounds still in the window
    // from the *previous* policy, and the test would pass with the rotation
    // switched off entirely.
    const known = new Set(all.map((draft) => draft.id));
    const deadline = Date.now() + 15_000;
    let minted: string | null = null;
    while (Date.now() < deadline && minted === null) {
      const now = (await asActor("GET", "/api/drafts", tokens["u-mod"] as string)).body.drafts as {
        id: string;
      }[];
      minted = now.find((draft) => !known.has(draft.id))?.id ?? null;
      if (minted === null) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(minted).not.toBeNull();

    // Now the window contains only rounds measured against the burned table, in
    // a world that has moved on from it.
    await flushWindow();
    const stale = await postureOf();
    expect(stale.gates.service_intact).toBe(false);
    expect(stale.ready).toBe(false);
    expect((await verifyCheckpoint("signoff", "anything")).body.correct).toBe(false);

    // ...and the contrast: the same intent written as a relationship rather than
    // a list goes green without being touched again, so what failed above was
    // the table, not the state of the board.
    expect((await goGreen()).ready).toBe(true);
  }, 90_000);

  it("should score reads and publishes independently, so a half fix is a half score", async () => {
    // The single most common partial fix in the field: the read path is closed
    // and the write path is forgotten.
    const state = await applyAndSettle({
      enabled: true,
      readsPerRound: 200,
      rules: [
        { effect: "allow", actions: ["read"], actor: "*", resource: { ownerIs: "actor" } },
        { effect: "allow", actions: ["read"], actor: { role: "moderator" }, resource: "*" },
        { effect: "allow", actions: ["publish"], actor: "*", resource: "*" },
      ],
    });
    expect(state.gates.service_intact).toBe(true);
    expect(state.gates.reads_held).toBe(true);
    expect(state.gates.publishes_held).toBe(false);
    expect(state.ready).toBe(false);

    expect((await verifyCheckpoint("stop-the-leak", state.tokens.reads_held as string)).body.correct).toBe(
      true,
    );
    expect(
      (await verifyCheckpoint("keep-serving", state.tokens.service_intact as string)).body.correct,
    ).toBe(true);
    expect((await verifyCheckpoint("close-the-write-path", "anything")).body.correct).toBe(false);
    expect((await verifyCheckpoint("signoff", "anything")).body.correct).toBe(false);
  }, 60_000);

  it("should let an explicit deny beat an allow, whichever order they are written in", async () => {
    // `/api/policy` publishes "default deny; an explicit deny beats any allow"
    // as the evaluation rule, and a participant who reaches for deny-override is
    // writing a perfectly ordinary policy. If the deny were merely another
    // clause, the catch-all above it would win and the board would still be
    // wide open — with the participant looking at a rule they believe they wrote.
    const allowEverything = {
      effect: "allow",
      actions: ["read", "publish"],
      actor: "*",
      resource: "*",
    };
    const denyOthers = {
      effect: "deny",
      actions: ["read"],
      actor: "*",
      resource: { ownerIsNot: "actor" },
    };
    for (const rules of [
      [allowEverything, denyOthers],
      [denyOthers, allowEverything],
    ]) {
      const state = await applyAndSettle({ enabled: true, readsPerRound: 200, rules });
      // The deny is doing real work: every forbidden read is refused...
      expect(state.gates.reads_held).toBe(true);
      // ...and it is doing too much of it, which is a different mistake and is
      // reported as one — the moderator has lost the access they are supposed to
      // have, so this is not the fix either.
      expect(state.gates.service_intact).toBe(false);
    }
    const measured = await drill();
    expect(measured.window.attack.read.leaked).toBe(0);
  }, 60_000);

  it("should refuse to run on a policy it cannot read, rather than pick a default", async () => {
    writePolicyText("{ this is not json");
    const policy = await get("/api/policy");
    expect(policy.body.ok).toBe(false);
    expect(policy.body.error).toContain("not valid JSON");
    expect(policy.body.policy).toBeNull();
    const tokens = await tokensFromDesk();
    const attempt = await asActor("GET", "/api/drafts", tokens["u-guest"] as string);
    expect(attempt.status).toBe(503);
    expect(attempt.body.error).toBe("policy_unloadable");
    await flushWindow();
    const state = await postureOf();
    expect(state.gates.policy_loaded).toBe(false);
    expect(state.gates.reads_held).toBe(false);
    expect(state.ready).toBe(false);
  }, 60_000);

  it("should report an unknown key rather than ignoring it", async () => {
    // The edit a participant actually makes by accident. Silently dropping it
    // would leave them staring at a rule they believe they wrote.
    writePolicy({ ...greenPolicy(), rules: [{ effect: "allow", action: ["read"], actor: "*", resource: "*" }] });
    const policy = await get("/api/policy");
    expect(policy.body.ok).toBe(false);
    expect(policy.body.error).toContain("action");
    writePolicy({ ...greenPolicy(), readsPerRound: 0 });
    expect((await get("/api/policy")).body.error).toContain("readsPerRound");
    // ...and a settings key the app does not read, at the top level, which is
    // the other half of the same accident: a knob that looks like it took
    // effect and did not.
    writePolicy({ ...greenPolicy(), draftsEnabled: true });
    expect((await get("/api/policy")).body.error).toContain("draftsEnabled");
  });

  it("should never execute what is in the policy file", async () => {
    // The file is data. If it were imported, this would be a module with a
    // side effect; it is parsed as JSON instead and refused.
    writePolicyText('export const authorize = () => { process.exit(0); };\n');
    const policy = await get("/api/policy");
    expect(policy.body.ok).toBe(false);
    expect((await get("/healthz")).status).toBe(200);
    // ...and the app is still there to say so.
    expect((await get("/api/drill")).status).toBe(200);
  });

  it("should log a policy failure once rather than flooding the ring", async () => {
    // The policy is re-read on every request and the drill sends a dozen a
    // round, so a line per failed read would bury the boot record and every
    // other diagnostic within seconds of a half-typed save.
    const countErrors = async () =>
      ((await get("/api/logs?limit=500")).body.lines as { message: string }[]).filter((line) =>
        line.message.startsWith("access policy error:"),
      ).length;
    writePolicyText("{ still not json");
    await get("/api/policy");
    const after = await countErrors();
    for (let attempt = 0; attempt < 40; attempt += 1) await get("/api/policy");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await countErrors()).toBe(after);
    await goGreen();
  }, 60_000);
});

describe("stackstack-defend: the answer never reaches a surface that hands it over", () => {
  it("should never print the marker on any surface but the one draft route", async () => {
    // Polled in the fixed state and again in the broken one, because the shape of
    // this failure is a publish path that carries a body: it would show up on a
    // public surface in exactly one of the two states and be missed by a test
    // that only looked at the other.
    //
    // The marker survives HTML escaping (it is hex and braces), so its absence
    // from a rendered page is a meaningful assertion rather than a tautology.
    const surfaces = [
      "/",
      "/desk",
      "/api/board",
      "/api/published",
      "/api/drill",
      "/posture",
      "/api/logs?limit=500",
      "/api/policy",
    ];
    for (const policy of [greenPolicy(), STARTER_POLICY]) {
      await applyAndSettle(policy);
      for (let sweep = 0; sweep < 6; sweep += 1) {
        for (const path of surfaces) {
          const response = await get(path);
          expect(response.text).not.toMatch(/TC\{leak_/);
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
    await goGreen();
  }, 90_000);

  it("should keep the publication queue free of draft bodies entirely", async () => {
    const queue = await get("/api/published");
    expect(queue.body.publications.length).toBeGreaterThan(0);
    for (const entry of queue.body.publications) {
      expect(Object.keys(entry).sort()).toEqual(
        ["at", "draftId", "origin", "ownerId", "publicationId", "publishedBy", "title"].sort(),
      );
    }
  });

  it("should keep receipts off the drill report", async () => {
    const state = await postureOf();
    const measured = await get("/api/drill");
    for (const token of [...Object.values(state.tokens), state.readyToken]) {
      if (typeof token === "string") expect(measured.text).not.toContain(token);
    }
    expect(measured.text).not.toMatch(/TC\{/);
  });

  it("should describe a failure as a symptom, not as the rule that fixes it", async () => {
    await applyAndSettle(STARTER_POLICY);
    const measured = await drill();
    expect(measured.lastFailures.length).toBeGreaterThan(0);
    const why = measured.lastFailures.map((entry: { why: string }) => entry.why).join("\n");
    for (const answer of ["ownerIs", "ownerIsNot", "moderator", "rules", "allow", "deny"]) {
      expect(why).not.toContain(answer);
    }
    await goGreen();
  }, 60_000);

  it("should keep the seeded operations rule on the board however long the drill runs", async () => {
    // It is the participant's only statement of the rule they are graded on. If
    // drill traffic could push it out of the board's ring, the problem would
    // quietly become unsolvable after an hour.
    const board = await get("/api/board");
    const memo = board.body.posts.find(
      (post: { seeded: boolean; body: string }) => post.seeded && post.body.includes("4-eyes"),
    );
    expect(memo).toBeDefined();
    expect(memo.body).toContain("本人と承認役");
    // Nothing the drill does writes to the board at all, which is what makes the
    // guarantee structural rather than a matter of ring size.
    expect(board.body.posts.every((post: { seeded: boolean }) => post.seeded)).toBe(true);
  });
});

describe("stackstack-defend: the app stays up and the scorer fails closed", () => {
  it("should survive a request target it cannot even parse, drill and all", async () => {
    await new Promise<void>((resolve) => {
      const socket = connect(PORT, "127.0.0.1", () => {
        socket.write("GET // HTTP/1.1\r\nHost: board.local\r\nConnection: close\r\n\r\n");
      });
      socket.on("close", () => resolve());
      socket.on("error", () => resolve());
      socket.setTimeout(3000, () => {
        socket.destroy();
        resolve();
      });
    });
    expect((await get("/healthz")).status).toBe(200);
    const before = (await drill()).roundsCompleted as number;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await drill()).roundsCompleted).toBeGreaterThan(before);
  });

  it("should escape what a participant writes before putting it on a page", async () => {
    const tokens = await tokensFromDesk();
    const payload = '<script>alert("xss")</script>';
    const created = await asActor("POST", "/api/drafts", tokens["u-guest"] as string, BOARD, {
      title: `t${payload}`,
      body: `b${payload}`,
    });
    expect(created.status).toBe(201);
    const desk = await get("/desk");
    expect(desk.text).not.toContain("<script>");
    expect(desk.text).toContain("&lt;script&gt;");
  });

  it("should 404 a route it does not serve and 400 an unknown checkpoint", async () => {
    expect((await get("/api/draft-not-really")).status).toBe(404);
    const unknown = await verifyCheckpoint("no-such-checkpoint", "anything");
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("unknown_checkpoint");
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await verifyCheckpoint(inherited, "anything");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_checkpoint");
    }
  });

  it("should still be green after everything this suite did to it", async () => {
    const state = await goGreen();
    expect(state.ready).toBe(true);
  }, 60_000);
});
