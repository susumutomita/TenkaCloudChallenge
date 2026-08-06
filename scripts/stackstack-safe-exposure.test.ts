import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-safe-exposure grades an authorization decision, and an
 * authorization decision is only worth anything if it is the one a real request
 * gets. So these tests drive the real app over real HTTP under Bun — with keys,
 * without keys, with a key this app has never seen — rather than asserting on
 * the scenario's source text.
 *
 * The two participant-owned files (the access document and the board config) are
 * copied into a scratch directory first. The suite rewrites the access document
 * the way a participant does, and must not leave the repository's shipped one
 * changed.
 *
 * Issue 286 asks for three families of automated test. They are the three
 * `describe` blocks named 認証 / 認可 / 正常系 below, and they run against the
 * reference policy on the main instance.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-safe-exposure");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "safe-exposure.mjs");

const SEED = "stackstack-safe-exposure-test-seed";
const ACCESS_HINT = "problems/challenges/stackstack-safe-exposure/local/access/access.json";
const CONFIG_HINT = "problems/challenges/stackstack-safe-exposure/local/config/app.json";
const SETTINGS_ENDPOINT = "/api/settings";

/** The four seeded documents, by the slug `/portal/review` names them with. */
const SLUGS = ["anzu-private", "kenji-private", "team-runbook", "hoshino-contract"] as const;
type Slug = (typeof SLUGS)[number];

const GATE_NAMES = [
  "service_intact",
  "drafts_usable",
  "drafts_scoped",
  "admin_available",
  "admin_sealed",
] as const;
type Gate = (typeof GATE_NAMES)[number];

interface Rule {
  id?: string;
  effect: "allow" | "deny";
  methods: string[];
  path: string;
  require?: string[];
}
interface Policy {
  defaultEffect: "allow" | "deny";
  rules: Rule[];
}

/**
 * A policy that passes, composed from named pieces rather than pasted as one
 * blob — so a test can drop exactly one rule and assert which gate notices.
 *
 * It is committed knowingly. This catalog is open source and the participant's
 * checkout carries `problems/scripts/`, so the answer cannot be hidden; the
 * problem's READMEs say so and price the hints accordingly. A suite with no
 * reference policy could only ever prove that wrong answers are refused, never
 * that a right one is accepted, and that is the more important guarantee.
 */
const REFERENCE_RULES: Record<string, Rule> = {
  "monitoring-is-public": {
    id: "monitoring-is-public",
    effect: "allow",
    methods: ["GET"],
    path: "/portal/healthz",
    require: [],
  },
  "admins-only": {
    id: "admins-only",
    effect: "allow",
    methods: ["*"],
    path: "/portal/admin/*",
    require: ["authenticated", "role:admin"],
  },
  "who-am-i": {
    id: "who-am-i",
    effect: "allow",
    methods: ["GET"],
    path: "/portal/me",
    require: ["authenticated"],
  },
  "my-drafts": {
    id: "my-drafts",
    effect: "allow",
    methods: ["GET", "POST"],
    path: "/portal/drafts",
    require: ["authenticated"],
  },
  "own-draft": {
    id: "own-draft",
    effect: "allow",
    methods: ["GET", "DELETE"],
    path: "/portal/draft",
    require: ["authenticated", "owner"],
  },
  "team-draft": {
    id: "team-draft",
    effect: "allow",
    methods: ["GET"],
    path: "/portal/draft",
    require: ["authenticated", "tenant", "shared"],
  },
};

/** The reference policy, optionally with named rules dropped or replaced. */
function referencePolicy(
  patch: { without?: string[]; replace?: Record<string, Rule> } = {},
): Policy {
  const without = new Set(patch.without ?? []);
  return {
    defaultEffect: "deny",
    rules: Object.entries(REFERENCE_RULES)
      .filter(([name]) => !without.has(name))
      .map(([name, rule]) => patch.replace?.[name] ?? rule),
  };
}

interface Metadata {
  readonly difficulty: number;
  readonly scoring: {
    readonly kind: string;
    readonly checks: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly points: number;
      readonly wrongAnswerPenalty?: number;
      readonly hints?: ReadonlyArray<{ readonly id: string; readonly penalty: number; readonly content: string }>;
    }>;
  };
  readonly i18n: {
    readonly en: {
      readonly checks: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly hints?: ReadonlyArray<{ readonly id: string; readonly content: string }>;
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

let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-safe-exposure-"));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

interface Probe {
  readonly name: string;
  readonly object: string | null;
  readonly expected: string;
  readonly got: string;
  readonly ok: boolean;
  readonly decidedBy: string;
}

interface Review {
  readonly policy: { loaded: boolean; file: string; problems: string[]; defaultEffect: string | null; ruleCount: number };
  readonly groups: Record<Gate, { ok: boolean; probes: Probe[] }>;
}

interface Posture {
  readonly gates: Record<Gate, boolean>;
  readonly tokens: Record<Gate, string | null>;
  readonly ready: boolean;
  readonly readyToken: string | null;
}

interface Instance {
  readonly board: string;
  readonly verifyPort: number;
  readonly accessPath: string;
  readonly configPath: string;
  kill(): void;
  stdout(): string;
}

async function startInstance(name: string, challengePort: number, verifyPort: number) {
  const accessPath = join(scratch, `${name}-access.json`);
  const configPath = join(scratch, `${name}-app.json`);
  const overrideDir = join(scratch, `${name}-overrides`);
  mkdirSync(overrideDir);
  writeFileSync(accessPath, readFileSync(join(PROBLEM_DIR, "local", "access", "access.json")));
  writeFileSync(configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));

  let stdout = "";
  const child = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "safe-exposure",
      FLAG_SEED: SEED,
      APP_CONFIG: configPath,
      APP_OVERRIDE_DIR: overrideDir,
      CONFIG_HINT,
      ACCESS_POLICY: accessPath,
      ACCESS_HINT,
      CHALLENGE_PORT: String(challengePort),
      VERIFY_PORT: String(verifyPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });

  const board = `http://127.0.0.1:${challengePort}`;
  const deadline = Date.now() + 6_000;
  for (;;) {
    try {
      if ((await fetch(`${board}/healthz`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`the ${name} instance never became healthy`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const instance: Instance = {
    board,
    verifyPort,
    accessPath,
    configPath,
    kill: () => child.kill(),
    stdout: () => stdout,
  };
  return instance;
}

/** The whole HTTP vocabulary these tests need, bound to one instance. */
function client(instance: () => Instance) {
  /**
   * The staging keys, read out of the app's own boot log rather than recomputed
   * here. A test that derived them from FLAG_SEED would keep passing if the app
   * stopped issuing the ones it prints.
   */
  const keys = () => {
    const line = /safe-exposure staging keys: (.+)/.exec(instance().stdout());
    if (line === null) throw new Error("the instance never printed its staging keys");
    return Object.fromEntries(
      (line[1] as string).trim().split(/\s+/).map((pair) => pair.split("=") as [string, string]),
    ) as Record<string, string>;
  };

  const send = async (path: string, { as = null as string | null, method = "GET", body = undefined as unknown }) => {
    const headers: Record<string, string> = {};
    if (as === "unknown") headers.authorization = `Bearer sk_${"0".repeat(20)}`;
    else if (as === "malformed") headers.authorization = "sk_not-even-a-bearer-header";
    else if (as !== null) headers.authorization = `Bearer ${keys()[as] as string}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${instance().board}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed, text };
  };

  return {
    keys,
    get: (path: string, as: string | null = null) => send(path, { as }),
    post: (path: string, as: string | null, body: unknown) => send(path, { as, method: "POST", body }),
    remove: (path: string, as: string | null = null) => send(path, { as, method: "DELETE" }),
    patchSettings: (settings: Record<string, unknown>) =>
      send("/api/settings", { method: "PATCH", body: settings }),
    resetSettings: () => send("/api/settings", { method: "DELETE" }),
    /** `id` is looked up per call: the ids are seed-derived and never committed. */
    async ids(): Promise<Record<Slug, string>> {
      const all = await send("/portal/admin/drafts", { as: "cto-daichi" });
      const drafts = (all.body?.drafts ?? []) as Array<{ id: string; owner: string; tenant: string; visibility: string }>;
      const find = (owner: string, tenant: string, visibility: string) =>
        drafts.find((d) => d.owner === owner && d.tenant === tenant && d.visibility === visibility)?.id as string;
      return {
        "anzu-private": find("sre-anzu", "tenka", "private"),
        "kenji-private": find("pm-kenji", "tenka", "private"),
        "team-runbook": find("pm-kenji", "tenka", "team"),
        "hoshino-contract": find("mika-hoshino", "hoshino", "private"),
      };
    },
    posture: async () => (await send("/posture", {})).body as Posture,
    review: async () => (await send("/portal/review", {})).body as Review,
    gates: async () => ((await send("/posture", {})).body as Posture).gates,
    writePolicy(policy: unknown) {
      writeFileSync(instance().accessPath, JSON.stringify(policy, null, 2));
    },
    writePolicyRaw(text: string) {
      writeFileSync(instance().accessPath, text);
    },
    async answer(checkpointId: string, submission: string) {
      const response = await fetch(`http://127.0.0.1:${instance().verifyPort}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId, submission, context: { teamId: "t", problemId: "p" } }),
      });
      return { status: response.status, body: (await response.json()) as any };
    },
    async correct(checkpointId: string, submission: string) {
      return ((await this.answer(checkpointId, submission)).body as { correct: boolean }).correct;
    },
  };
}

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(200);
  });

  it("should spend the Medium tier's whole wrong-answer budget and no more", () => {
    // The validator only enforces the tier value for a flat `points`, so spread
    // across checkpoints it still has to add up to 5% of the base.
    const spent = metadata.scoring.checks.reduce((sum, check) => sum + (check.wrongAnswerPenalty ?? 0), 0);
    expect(spent).toBe(10);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty ?? 0).toBeLessThanOrEqual(check.points);
    }
  });

  it("should leave slack under every per-checkpoint hint ceiling", () => {
    // Not just `<=`: a checkpoint sitting exactly on its ceiling turns any future
    // rebalance of its points into a CI failure nobody expected.
    for (const check of metadata.scoring.checks) {
      const spent = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(spent).toBeLessThan(check.points / 2);
    }
  });

  it("should keep the whole problem's hint budget under half the total", () => {
    const spent = metadata.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(spent).toBe(87);
    expect(spent).toBeLessThanOrEqual(100);
  });

  it("should charge for every hint, and charge more for each later one", () => {
    // The answer key is reachable in this repository, so a free opening hint
    // would make 30% of the problem a dictated command. Progressive, and never
    // zero: SCORING.md puts the near-answer at the expensive end.
    for (const check of metadata.scoring.checks) {
      const penalties = (check.hints ?? []).map((hint) => hint.penalty);
      expect(penalties.length).toBeGreaterThanOrEqual(2);
      for (const penalty of penalties) expect(penalty).toBeGreaterThan(0);
      expect([...penalties].sort((a, b) => a - b)).toEqual(penalties);
    }
  });

  it("should give every hint in the problem a unique id", () => {
    const ids = metadata.scoring.checks.flatMap((check) => (check.hints ?? []).map((hint) => hint.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should mirror every checkpoint and hint in the English overlay", () => {
    expect(metadata.i18n.en.checks.map((check) => check.id)).toEqual(
      metadata.scoring.checks.map((check) => check.id),
    );
    for (const check of metadata.scoring.checks) {
      const english = metadata.i18n.en.checks.find((entry) => entry.id === check.id);
      expect((english?.hints ?? []).map((hint) => hint.id)).toEqual((check.hints ?? []).map((hint) => hint.id));
    }
  });

  it("should keep the rule text out of every hint but the last of its checkpoint", () => {
    // The near-answer hint may print the rule; a cheaper one printing it would
    // sell the insight at a discount, which defeats a hint budget without
    // exceeding it.
    for (const check of [...metadata.scoring.checks, ...metadata.i18n.en.checks]) {
      const hints = check.hints ?? [];
      hints.slice(0, -1).forEach((hint) => {
        expect(hint.content).not.toContain('"effect"');
        expect(hint.content).not.toContain("defaultEffect");
      });
    }
  });

  it("should name the asset in every participant-visible label, never the finding", () => {
    const labels = [...metadata.scoring.checks, ...metadata.i18n.en.checks].map((check) => check.label);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(80);
      expect(label.toLowerCase()).not.toMatch(/idor|broken access control|authoriz|認可|脆弱/);
    }
  });

  it("should not put the inventory of what leaks into the participant-facing story", () => {
    // AGENT.md §10: the CTO's order plus an empty document is enough stakes.
    // Listing what is currently reachable would hand over the discovery.
    const full = metadata as unknown as {
      shortDescription: string;
      instructions: string;
      i18n: { en: { shortDescription: string; instructions: string } };
    };
    // Only the fields the portal renders to a competitor. `description` is
    // author-only by AGENT.md §10 and holds the scoring rules on purpose.
    const visible = JSON.stringify([
      full.shortDescription,
      full.instructions,
      full.i18n.en.shortDescription,
      full.i18n.en.instructions,
    ]);
    for (const spoiler of [
      "/portal/admin",
      "role:admin",
      "hoshino-contract",
      "誰でも読めます",
      "anyone can read",
      "TC{",
    ]) {
      expect(visible).not.toContain(spoiler);
    }
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure as it ships", () => {
  /**
   * The starter state, asserted before anything is fixed. Everything works and
   * nothing is protected — which is the state a participant arrives in, and the
   * state in which no checkpoint may be earnable.
   */
  let instance: Instance;
  const app = client(() => instance);

  beforeAll(async () => {
    instance = await startInstance("ships", 18320, 18321);
  });
  afterAll(() => instance?.kill());

  it("should change and reset the access policy through the API without touching its source", async () => {
    const source = readFileSync(instance.accessPath, "utf8");
    const changed = await app.patchSettings({ defaultEffect: "deny" });
    expect(changed.status).toBe(200);
    expect(changed.body.settings.defaultEffect).toBe("deny");
    expect(readFileSync(instance.accessPath, "utf8")).toBe(source);

    const reset = await app.resetSettings();
    expect(reset.status).toBe(200);
    expect(reset.body.settings.defaultEffect).toBe("allow");
    expect(readFileSync(instance.accessPath, "utf8")).toBe(source);
  });

  it("should ship a document that is open, and say what it decided", async () => {
    const review = await app.review();
    expect(review.policy.loaded).toBe(true);
    expect(review.policy.defaultEffect).toBe("allow");
    // Every anonymous read is decided by the fallthrough, not by a rule.
    const probe = review.groups.drafts_scoped.probes.find((entry) => entry.object === "kenji-private");
    expect(probe).toMatchObject({ expected: "403", got: "200", ok: false, decidedBy: "default" });
  });

  it("should start with the service working and nothing sealed", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      service_intact: true,
      drafts_usable: true,
      drafts_scoped: false,
      admin_available: true,
      admin_sealed: false,
    });
    expect(state.tokens.drafts_scoped).toBeNull();
    expect(state.tokens.admin_sealed).toBeNull();
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should let anyone reach the admin surface, which is the finding", async () => {
    const audit = await app.get("/portal/admin/audit");
    expect(audit.status).toBe(200);
    const handover = await app.get("/portal/admin/handover");
    expect(handover.status).toBe(200);
    expect(handover.body.note).toContain("TC{handover_");
  });

  it("should hand another tenant's private document to a colleague who asks", async () => {
    const ids = await app.ids();
    const leaked = await app.get(`/portal/draft?id=${ids["hoshino-contract"]}`, "sre-anzu");
    expect(leaked.status).toBe(200);
    expect(leaked.body.draft.body).toContain("TC{exposed_");
  });

  it("should fail every checkpoint on the untouched starter", async () => {
    // The whole-problem version of "no vacuous pass": before anything is done,
    // there is no submission that earns anything — including the values the app
    // is genuinely handing out right now.
    const ids = await app.ids();
    const leaked = await app.get(`/portal/draft?id=${ids["hoshino-contract"]}`, "sre-anzu");
    const mark = /TC\{exposed_[0-9a-f]{16}\}/.exec(leaked.body.draft.body as string)?.[0] as string;
    const handover = await app.get("/portal/admin/handover");
    const handoverMark = /TC\{handover_[0-9a-f]{16}\}/.exec(handover.body.note as string)?.[0] as string;
    const posture = await app.posture();

    // The one checkpoint that IS earnable here — the discovery — is earnable
    // here on purpose, and only with the value read out of the running app.
    expect(await app.correct("exposed-record", mark)).toBe(true);
    expect(await app.correct("exposed-record", handoverMark)).toBe(false);
    expect(await app.correct("exposed-record", "TC{exposed_0000000000000000}")).toBe(false);

    // The receipts that DO exist right now are for the three gates that are
    // already green, and none of them is the answer to anything.
    for (const gate of ["service_intact", "drafts_usable", "admin_available"] as Gate[]) {
      const token = posture.tokens[gate] as string;
      expect(token).not.toBeNull();
      for (const checkpoint of ["admin-sealed", "drafts-sealed", "exposure-signoff"]) {
        expect(await app.correct(checkpoint, token)).toBe(false);
      }
    }
    for (const checkpoint of ["admin-sealed", "drafts-sealed", "exposure-signoff"]) {
      expect(await app.correct(checkpoint, "TC{ready_0000000000000000}")).toBe(false);
      expect(await app.correct(checkpoint, "")).toBe(false);
    }
  });

  it("should tell a denied caller nothing about whether an id exists", async () => {
    // Under a policy that denies this caller, a document that is not there and
    // one they may not read are the same answer. Under the shipped allow-all
    // they differ, which is what makes this a property of the decision order and
    // not of the router.
    const ids = await app.ids();
    const open = await app.get(`/portal/draft?id=${ids["kenji-private"]}`, "sre-anzu");
    const missing = await app.get("/portal/draft?id=d-0000000000", "sre-anzu");
    expect(open.status).toBe(200);
    expect(missing.status).toBe(404);

    app.writePolicy(referencePolicy());
    const denied = await app.get(`/portal/draft?id=${ids["kenji-private"]}`, "sre-anzu");
    const deniedMissing = await app.get("/portal/draft?id=d-0000000000", "sre-anzu");
    expect(denied.status).toBe(403);
    expect(deniedMissing.status).toBe(403);
    expect(denied.text).toBe(deniedMissing.text);
  });

  it("should keep the four staging keys reachable however much traffic arrives", async () => {
    // The keys are in the log's pinned prologue. A participant who probes a few
    // hundred paths must not lose the only place they are written down.
    for (let attempt = 0; attempt < 600; attempt += 1) await app.get(`/portal/nope-${attempt}`);
    const logs = await app.get("/api/logs");
    const line = (logs.body.lines as Array<{ message: string }>).find((entry) =>
      entry.message.startsWith("safe-exposure staging keys:"),
    );
    expect(line).toBeDefined();
    for (const key of Object.values(app.keys())) expect(line?.message).toContain(key);
  });

  it("should not raise a gate for a route it 404s", async () => {
    const before = await app.gates();
    await app.get("/portal/admin/not-really");
    expect(await app.gates()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure 認証 (authentication)", () => {
  /**
   * Completion condition 1 of 3. Under the reference policy: no key, a malformed
   * header, and a key this app has never issued are all refused on everything
   * that is not deliberately public — and the public one still answers.
   */
  let instance: Instance;
  const app = client(() => instance);
  let ids: Record<Slug, string>;

  beforeAll(async () => {
    instance = await startInstance("authn", 18322, 18323);
    ids = await app.ids();
    app.writePolicy(referencePolicy());
  });
  afterAll(() => instance?.kill());

  const PROTECTED = () => [
    "/portal/me",
    "/portal/drafts",
    `/portal/draft?id=${ids["anzu-private"]}`,
    "/portal/admin/handover",
    "/portal/admin/audit",
    "/portal/admin/drafts",
  ];

  it("should refuse every protected route to a caller with no credential", async () => {
    for (const path of PROTECTED()) {
      const response = await app.get(path, null);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("unauthenticated");
    }
  });

  it("should refuse a key that is well formed and unknown, and say which it was", async () => {
    for (const path of PROTECTED()) {
      const response = await app.get(path, "unknown");
      expect(response.status).toBe(401);
      expect(response.body.detail).toContain("not one this app knows");
    }
  });

  it("should refuse an Authorization header that is not a Bearer header at all", async () => {
    const response = await app.get("/portal/me", "malformed");
    expect(response.status).toBe(401);
  });

  it("should not accept a key that is a prefix or a suffix of a real one", async () => {
    const real = app.keys()["sre-anzu"] as string;
    for (const forged of [real.slice(0, -1), `${real}0`, real.toUpperCase(), real.replace("sk_", "")]) {
      const response = await fetch(`${instance.board}/portal/me`, {
        headers: { authorization: `Bearer ${forged}` },
      });
      expect(response.status).toBe(401);
    }
    // ...and the real one still works, so the four above are not passing merely
    // because the route refuses everything.
    expect((await app.get("/portal/me", "sre-anzu")).status).toBe(200);
  });

  it("should keep the monitoring path answering with no credential at all", async () => {
    const health = await app.get("/portal/healthz", null);
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });

  it("should tell a valid key which identity it is", async () => {
    for (const [subject, tenant, role] of [
      ["sre-anzu", "tenka", "member"],
      ["pm-kenji", "tenka", "member"],
      ["mika-hoshino", "hoshino", "member"],
      ["cto-daichi", "tenka", "admin"],
    ]) {
      const me = await app.get("/portal/me", subject);
      expect(me.status).toBe(200);
      expect(me.body.principal).toEqual({ subject, tenant, role });
    }
  });

  it("should keep the instrument panel open however far the document closes", async () => {
    app.writePolicy({ defaultEffect: "deny", rules: [] });
    expect((await app.get("/portal")).status).toBe(200);
    expect((await app.get("/portal/review")).status).toBe(200);
    expect((await app.get("/posture")).status).toBe(200);
    expect((await app.get("/portal/me", "cto-daichi")).status).toBe(403);
    app.writePolicy(referencePolicy());
  });

  it("should report a document it cannot load as an outage, and name the problem", async () => {
    app.writePolicyRaw("{ this is not json");
    const health = await app.get("/portal/healthz", null);
    expect(health.status).toBe(503);
    expect(health.body.error).toBe("policy_error");
    expect(String(health.body.detail)).toContain("not valid JSON");
    expect(health.body.file).toBe(SETTINGS_ENDPOINT);

    // The panel still explains it, and the board itself is unaffected: the
    // access document governs /portal, and this README-level claim is asserted
    // rather than promised.
    expect((await app.get("/portal/review")).body.policy.loaded).toBe(false);
    expect((await app.get("/healthz")).status).toBe(200);
    expect((await app.get("/api/board")).status).toBe(200);

    const logs = await app.get("/api/logs?limit=200");
    expect(
      (logs.body.lines as Array<{ message: string }>).some((line) =>
        line.message.startsWith("access policy error:"),
      ),
    ).toBe(true);

    app.writePolicy(referencePolicy());
    expect((await app.get("/portal/healthz", null)).status).toBe(200);
  });

  it("should refuse a requirement it does not have, by name, rather than ignoring it", async () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["client-ip:127.0.0.1/32", "the address this app sees is the proxy's"],
      ["ip:10.0.0.0/8", "the address this app sees is the proxy's"],
      ["role:superuser", "unknown requirement"],
      ["ownerOf", "unknown requirement"],
    ];
    for (const [requirement, explanation] of cases) {
      app.writePolicy({
        defaultEffect: "deny",
        rules: [{ effect: "allow", methods: ["*"], path: "*", require: [requirement] }],
      });
      const health = await app.get("/portal/healthz", null);
      expect(health.status).toBe(503);
      expect(String(health.body.detail)).toContain(explanation);
      // A document that will not load is an outage in every direction, not a
      // lockdown that scores: every gate goes red, including the sealed ones.
      const gates = await app.gates();
      expect(Object.values(gates).every((value) => value === false)).toBe(true);
    }
    app.writePolicy(referencePolicy());
  });

  it("should refuse a rule shape it does not have, rather than adopting half of it", async () => {
    const cases: ReadonlyArray<[unknown, string]> = [
      [{ defaultEffect: "maybe", rules: [] }, "defaultEffect"],
      [{ defaultEffect: "deny", rules: {} }, "rules must be an array"],
      [{ defaultEffect: "deny", rules: [{ effect: "allow", methods: [], path: "/portal/me" }] }, "methods"],
      [{ defaultEffect: "deny", rules: [{ effect: "allow", methods: ["GET"], path: "" }] }, "path"],
      [{ defaultEffect: "deny", rules: [{ effect: "allow", methods: ["GET"], path: "/por*tal" }] }, 'trailing "/*"'],
      [{ defaultEffect: "deny", rules: [{ effect: "allow", methods: ["GET"], path: "/x", extra: 1 }] }, "not a field a rule has"],
      [{ defaultEffect: "deny", rules: [], defaultEffekt: "allow" }, "not a field this access document has"],
    ];
    for (const [document, expected] of cases) {
      app.writePolicy(document);
      const health = await app.get("/portal/healthz", null);
      expect(health.status).toBe(503);
      expect(String(health.body.detail)).toContain(expected);
    }
    app.writePolicy(referencePolicy());
    expect((await app.get("/portal/healthz", null)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure 認可 (authorization)", () => {
  /**
   * Completion condition 2 of 3, asserted cell by cell: five callers against
   * seven targets under the reference policy, including the cell that must stay
   * ALLOW across an ownership boundary (a colleague reading the team runbook)
   * and the one that must stay DENY across a tenant boundary despite being
   * shared (the customer reading that same runbook).
   */
  let instance: Instance;
  const app = client(() => instance);
  let ids: Record<Slug, string>;

  beforeAll(async () => {
    instance = await startInstance("authz", 18324, 18325);
    ids = await app.ids();
    app.writePolicy(referencePolicy());
  });
  afterAll(() => instance?.kill());

  it("should decide the whole caller-by-object matrix the way the document says", async () => {
    const matrix: ReadonlyArray<[string | null, string, number]> = [
      // the caller's own work
      ["sre-anzu", "anzu-private", 200],
      ["pm-kenji", "kenji-private", 200],
      ["mika-hoshino", "hoshino-contract", 200],
      // shared with the team, inside the tenant
      ["sre-anzu", "team-runbook", 200],
      ["cto-daichi", "team-runbook", 200],
      // somebody else's, same tenant
      ["sre-anzu", "kenji-private", 403],
      ["pm-kenji", "anzu-private", 403],
      // an admin is not automatically a reader of a private draft
      ["cto-daichi", "kenji-private", 403],
      // across the tenant boundary, in both directions
      ["sre-anzu", "hoshino-contract", 403],
      ["mika-hoshino", "anzu-private", 403],
      // shared, but shared inside somebody else's tenant
      ["mika-hoshino", "team-runbook", 403],
      // no credential at all
      [null, "anzu-private", 401],
      [null, "team-runbook", 401],
      ["unknown", "hoshino-contract", 401],
    ];
    for (const [as, slug, expected] of matrix) {
      const response = await app.get(`/portal/draft?id=${ids[slug as Slug]}`, as);
      expect(`${as ?? "nobody"} → ${slug}: ${response.status}`).toBe(`${as ?? "nobody"} → ${slug}: ${expected}`);
    }
  });

  it("should filter the collection by the same decision the object route makes", async () => {
    const list = await app.get("/portal/drafts", "sre-anzu");
    expect(list.status).toBe(200);
    const returned = (list.body.drafts as Array<{ id: string }>).map((draft) => draft.id).sort();
    expect(returned).toEqual([ids["anzu-private"], ids["team-runbook"]].sort());

    const customer = await app.get("/portal/drafts", "mika-hoshino");
    expect((customer.body.drafts as Array<{ id: string }>).map((draft) => draft.id)).toEqual([
      ids["hoshino-contract"],
    ]);
  });

  it("should never let the list disagree with a read", async () => {
    // The classic leak is a collection route written separately from the object
    // route. Asserted as an equivalence over every caller and every document.
    for (const as of ["sre-anzu", "pm-kenji", "mika-hoshino", "cto-daichi"]) {
      const list = await app.get("/portal/drafts", as);
      const listed = new Set((list.body.drafts as Array<{ id: string }>).map((draft) => draft.id));
      for (const slug of SLUGS) {
        const readable = (await app.get(`/portal/draft?id=${ids[slug]}`, as)).status === 200;
        expect(`${as}/${slug} listed=${listed.has(ids[slug])}`).toBe(`${as}/${slug} listed=${readable}`);
      }
    }
  });

  it("should refuse every admin route to everybody who is not an admin", async () => {
    for (const path of ["/portal/admin/handover", "/portal/admin/audit", "/portal/admin/drafts"]) {
      for (const [as, expected] of [
        [null, 401],
        ["unknown", 401],
        ["sre-anzu", 403],
        ["pm-kenji", 403],
        ["mika-hoshino", 403],
      ] as ReadonlyArray<[string | null, number]>) {
        expect(`${path} as ${as ?? "nobody"}: ${(await app.get(path, as)).status}`).toBe(
          `${path} as ${as ?? "nobody"}: ${expected}`,
        );
      }
      expect((await app.get(path, "cto-daichi")).status).toBe(200);
    }
  });

  it("should refuse the destructive admin route to everybody who is not an admin", async () => {
    // Deliberately aimed at an id that has never existed. A policy that wrongly
    // allows this must answer 404 — which fails the assertion — rather than
    // removing something the participant owns.
    for (const [as, expected] of [
      [null, 401],
      ["unknown", 401],
      ["sre-anzu", 403],
      ["mika-hoshino", 403],
    ] as ReadonlyArray<[string | null, number]>) {
      expect((await app.remove("/portal/admin/draft?id=d-nevermade1", as)).status).toBe(expected);
    }
    expect((await app.remove("/portal/admin/draft?id=d-nevermade1", "cto-daichi")).status).toBe(404);
  });

  it("should refuse a delete of somebody else's document without removing it", async () => {
    const before = (await app.get("/portal/admin/drafts", "cto-daichi")).body.drafts.length as number;
    expect((await app.remove(`/portal/draft?id=${ids["kenji-private"]}`, "sre-anzu")).status).toBe(403);
    expect((await app.remove(`/portal/draft?id=${ids["team-runbook"]}`, "mika-hoshino")).status).toBe(403);
    expect((await app.remove(`/portal/draft?id=${ids["anzu-private"]}`, null)).status).toBe(401);
    const after = (await app.get("/portal/admin/drafts", "cto-daichi")).body.drafts.length as number;
    expect(after).toBe(before);
  });

  it("should take owner and tenant from the key, never from the request body", async () => {
    const created = await app.post("/portal/drafts", "mika-hoshino", {
      title: "forged",
      body: "",
      owner: "cto-daichi",
      tenant: "tenka",
    });
    expect(created.status).toBe(201);
    expect(created.body.draft.owner).toBe("mika-hoshino");
    expect(created.body.draft.tenant).toBe("hoshino");
    // ...and it is not visible to the other tenant, which is the point of it.
    expect((await app.get(`/portal/draft?id=${created.body.draft.id}`, "sre-anzu")).status).toBe(403);
    expect((await app.remove(`/portal/draft?id=${created.body.draft.id}`, "mika-hoshino")).status).toBe(200);
  });

  it("should match a trailing wildcard on longer paths only", async () => {
    // `/portal/admin/*` must not cover `/portal/admin`, and must cover every
    // route under it. Asserted through the app rather than against the matcher.
    app.writePolicy({
      defaultEffect: "deny",
      rules: [
        { id: "wildcard", effect: "allow", methods: ["*"], path: "/portal/admin/*", require: [] },
        { id: "exact", effect: "allow", methods: ["GET"], path: "/portal/me", require: [] },
      ],
    });
    expect((await app.get("/portal/admin/audit", null)).status).toBe(200);
    expect((await app.get("/portal/me", null)).status).toBe(200);
    expect((await app.get("/portal/drafts", null)).status).toBe(401);

    app.writePolicy({
      defaultEffect: "deny",
      rules: [{ id: "star", effect: "allow", methods: ["*"], path: "*", require: [] }],
    });
    expect((await app.get("/portal/drafts", null)).status).toBe(200);
    app.writePolicy(referencePolicy());
  });

  it("should skip a rule whose requirements do not hold rather than treating it as a refusal", async () => {
    // First-match-wins over the whole triple (method, path, require) is what
    // lets "mine, or shared with my tenant" be two rules. If a path match alone
    // ended evaluation, the second rule could never fire.
    const list = await app.get(`/portal/draft?id=${ids["team-runbook"]}`, "sre-anzu");
    expect(list.status).toBe(200);
    const review = await app.review();
    const probe = review.groups.service_intact.probes.find((entry) => entry.object === "team-runbook");
    expect(probe?.decidedBy).toBe("team-draft");
  });

  it("should treat owner, tenant and shared as false where there is no single object", async () => {
    app.writePolicy({
      defaultEffect: "deny",
      rules: [
        { id: "objectish", effect: "allow", methods: ["GET"], path: "/portal/drafts", require: ["authenticated", "owner"] },
        ...referencePolicy().rules,
      ],
    });
    // The collection route has no one object, so `owner` cannot hold there and
    // the rule above never fires — the reference rule underneath it does.
    const list = await app.get("/portal/drafts", "sre-anzu");
    expect(list.status).toBe(200);
    const review = await app.review();
    const probe = review.groups.drafts_usable.probes.find((entry) => entry.name.includes("sre-anzu's list"));
    expect(probe?.decidedBy).toBe("my-drafts");
    app.writePolicy(referencePolicy());
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure 正常系 (normal use)", () => {
  /**
   * Completion condition 3 of 3, asserted as a sequence rather than as isolated
   * calls: a regression that breaks the flow between two working calls would
   * otherwise pass every one of them.
   */
  let instance: Instance;
  const app = client(() => instance);

  beforeAll(async () => {
    instance = await startInstance("normal", 18326, 18327);
    app.writePolicy(referencePolicy());
  });
  afterAll(() => instance?.kill());

  it("should carry a member through write, read back, list and remove", async () => {
    const created = await app.post("/portal/drafts", "sre-anzu", { title: "移行メモ 2", body: "手順の続き" });
    expect(created.status).toBe(201);
    const id = created.body.draft.id as string;
    expect(id).toMatch(/^d-[0-9a-f]{10}$/);

    expect((await app.get(`/portal/draft?id=${id}`, "sre-anzu")).body.draft.title).toBe("移行メモ 2");
    const list = await app.get("/portal/drafts", "sre-anzu");
    expect((list.body.drafts as Array<{ id: string }>).some((draft) => draft.id === id)).toBe(true);
    expect((await app.remove(`/portal/draft?id=${id}`, "sre-anzu")).status).toBe(200);
    expect((await app.get(`/portal/draft?id=${id}`, "sre-anzu")).status).toBe(403);
  });

  it("should carry the customer through the same flow inside their own tenant", async () => {
    const created = await app.post("/portal/drafts", "mika-hoshino", { title: "契約更新 メモ", body: "" });
    expect(created.status).toBe(201);
    const id = created.body.draft.id as string;
    expect((await app.get(`/portal/draft?id=${id}`, "mika-hoshino")).status).toBe(200);
    const list = await app.get("/portal/drafts", "mika-hoshino");
    expect((list.body.drafts as Array<{ tenant: string }>).every((draft) => draft.tenant === "hoshino")).toBe(true);
    expect((await app.remove(`/portal/draft?id=${id}`, "mika-hoshino")).status).toBe(200);
  });

  it("should let a member share a new draft with their team and a colleague read it", async () => {
    const created = await app.post("/portal/drafts", "pm-kenji", {
      title: "共有メモ",
      body: "",
      visibility: "team",
    });
    expect(created.status).toBe(201);
    const id = created.body.draft.id as string;
    expect((await app.get(`/portal/draft?id=${id}`, "sre-anzu")).status).toBe(200);
    expect((await app.get(`/portal/draft?id=${id}`, "mika-hoshino")).status).toBe(403);
    expect((await app.remove(`/portal/draft?id=${id}`, "pm-kenji")).status).toBe(200);
  });

  it("should keep the board itself working, which the document never governed", async () => {
    expect((await app.get("/")).status).toBe(200);
    expect((await app.get("/api/board")).status).toBe(200);
    expect((await app.get("/healthz")).status).toBe(200);
    const posted = await app.post("/api/posts", null, { author: "sre-anzu", title: "レビュー完了", body: "" });
    expect(posted.status).toBe(201);
  });

  it("should reject a malformed draft with a reason rather than a refusal", async () => {
    for (const [payload, expected] of [
      [{ body: "no title" }, "title"],
      [{ title: "   ", body: "" }, "title"],
      [{ title: "x", body: 7 }, "body"],
      [{ title: "x", visibility: "everyone" }, "visibility"],
    ] as ReadonlyArray<[unknown, string]>) {
      const response = await app.post("/portal/drafts", "sre-anzu", payload);
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(expected);
    }
  });

  it("should answer an oversize body rather than resetting the socket", async () => {
    const response = await app.post("/portal/drafts", "sre-anzu", { title: "big", body: "x".repeat(70 * 1024) });
    expect(response.status).toBe(400);
    expect((await app.get("/portal/healthz", null)).status).toBe(200);
  });

  it("should keep a keep-alive connection usable after refusing an oversize body", async () => {
    // The test above answers the oversize request and stops there, and it goes
    // through `app.post` then `app.get` — two connections, so it says nothing
    // about reuse. This one writes both requests onto a single socket.
    //
    // What it pins is the observable contract: after a 400 for an oversize
    // body, the next request on that same connection is still parsed as a
    // request rather than out of whatever the first one left behind.
    //
    // Be clear about what it is not. It is a contract test, not a regression
    // guard aimed at one implementation: refusing by `pause()`, by draining
    // with `resume()`, and by `request.destroy()` all satisfy it on this
    // runtime — checked, including with a genuinely incomplete body (a declared
    // Content-Length of 200 KiB with 80 KiB written, answered early, then the
    // remainder plus a second request). Bun's parser skips the rest of the
    // declared length and picks the next request up cleanly in every case.
    const payload = JSON.stringify({ title: "big", body: "x".repeat(70 * 1024) });
    const key = app.keys()["sre-anzu"] as string;
    const conversation = await new Promise<string>((resolve, reject) => {
      let seen = "";
      let followed = false;
      const socket = connect(18326, "127.0.0.1", () => {
        socket.write(
          `POST /portal/drafts HTTP/1.1\r\nHost: board.local\r\n` +
            `Authorization: Bearer ${key}\r\nContent-Type: application/json\r\n` +
            `Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: keep-alive\r\n\r\n${payload}`,
        );
      });
      socket.on("data", (chunk) => {
        seen += chunk.toString("utf8");
        // Second request only once the first has been answered, so this
        // measures reuse of the connection rather than pipelining. The flag is
        // its own variable: writing a marker into `seen` runs the two responses
        // together on one line, and the anchored match below then misses the
        // second one and reports a failure that is entirely the test's own.
        if (!followed && seen.includes("\r\n\r\n")) {
          followed = true;
          socket.write("GET /portal/healthz HTTP/1.1\r\nHost: board.local\r\nConnection: close\r\n\r\n");
        }
      });
      socket.on("close", () => resolve(seen));
      socket.on("error", reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve(seen);
      });
    });
    // Both answered, in order, on the one connection. Unanchored on purpose:
    // an HTTP body is not newline-terminated, so the second response begins
    // immediately after the first one's closing brace and `^` never sees it.
    const statuses = [...conversation.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => Number(match[1]));
    expect(statuses).toEqual([400, 200]);
    // And the second answer is the health payload, rather than a fragment of
    // the rejected body re-parsed as whatever it happened to look like.
    expect(conversation).toContain('{"ok":true,"policy":"loaded"');
  });

  it("should record its own decisions, including the ones it refused", async () => {
    await app.get("/portal/admin/audit", null);
    const audit = await app.get("/portal/admin/audit", "cto-daichi");
    expect(audit.status).toBe(200);
    const decisions = audit.body.decisions as Array<{ subject: string | null; method: string; path: string; effect: string; status: number }>;
    expect(decisions.some((entry) => entry.subject === null && entry.path === "/portal/admin/audit" && entry.effect === "deny")).toBe(true);
    expect(decisions.some((entry) => entry.subject === "sre-anzu" && entry.effect === "allow")).toBe(true);
    // The gates run dozens of probes on every /posture call; recording those
    // would evict the participant's own history within a few polls.
    await app.posture();
    const after = await app.get("/portal/admin/audit", "cto-daichi");
    expect((after.body.decisions as unknown[]).length).toBeLessThanOrEqual(decisions.length + 3);
  });

  it("should survive a request target it cannot even parse", async () => {
    await new Promise<void>((resolve) => {
      const socket = connect(18326, "127.0.0.1", () => {
        socket.write("GET // HTTP/1.1\r\nHost: board.local\r\nConnection: close\r\n\r\n");
      });
      socket.on("close", () => resolve());
      socket.on("error", () => resolve());
      socket.setTimeout(3000, () => {
        socket.destroy();
        resolve();
      });
    });
    expect((await app.get("/healthz")).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:18327/healthz`)).ok).toBe(true);
  });

  it("should escape what a participant writes before putting it on the console", async () => {
    app.writePolicyRaw(JSON.stringify({ defaultEffect: '<script>alert("x")</script>', rules: [] }));
    const page = await app.get("/portal");
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<script>alert");
    expect(page.text).toContain("&lt;script&gt;");
    app.writePolicy(referencePolicy());
  });

  it("should keep every console link relative, so a forwarded origin works", async () => {
    const page = await app.get("/portal");
    expect(page.text).not.toContain("http://127.0.0.1");
    expect(page.text).not.toContain("http://localhost");
    expect(page.text).not.toMatch(/href="\//);
  });

  it("should stay well throughout: no uncaught fault was taken", async () => {
    const health = await app.get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body.faults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure checkpoints", () => {
  let instance: Instance;
  const app = client(() => instance);
  let ids: Record<Slug, string>;
  let mark = "";
  let handoverMark = "";

  beforeAll(async () => {
    instance = await startInstance("checks", 18328, 18329);
    ids = await app.ids();
    const leaked = await app.get(`/portal/draft?id=${ids["hoshino-contract"]}`, "sre-anzu");
    mark = /TC\{exposed_[0-9a-f]{16}\}/.exec(leaked.body.draft.body as string)?.[0] as string;
    const handover = await app.get("/portal/admin/handover", "cto-daichi");
    handoverMark = /TC\{handover_[0-9a-f]{16}\}/.exec(handover.body.note as string)?.[0] as string;
    app.writePolicy(referencePolicy());
  });
  afterAll(() => instance?.kill());

  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await app.answer(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    const source = readFileSync(SCENARIO_FILE, "utf8");
    const block = source.slice(source.indexOf("export const checks = {"));
    const handlers = [...block.matchAll(/^ {2}"([a-z][a-z0-9-]*)":/gm)].map((match) => match[1] as string);
    expect(handlers.sort()).toEqual(metadata.scoring.checks.map((check) => check.id).sort());
  });

  it("should fail closed on a checkpoint id it does not know", async () => {
    const response = await app.answer("no-such-checkpoint", "anything");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_checkpoint");
  });

  it("should fail closed on an inherited property name, not call it", async () => {
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await app.answer(inherited, "anything");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_checkpoint");
    }
  });

  it("should turn every gate green under a policy that does the job", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      service_intact: true,
      drafts_usable: true,
      drafts_scoped: true,
      admin_available: true,
      admin_sealed: true,
    });
    expect(state.ready).toBe(true);
    expect(state.readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
    for (const gate of GATE_NAMES) expect(state.tokens[gate]).toMatch(/^TC\{[a-z_]+_[0-9a-f]{16}\}$/);
  });

  it("should credit every checkpoint for the value the app actually emitted", async () => {
    const state = await app.posture();
    expect(await app.correct("exposed-record", mark)).toBe(true);
    expect(await app.correct("exposed-record", ` ${mark} `)).toBe(true);
    expect(await app.correct("admin-sealed", state.tokens.admin_sealed as string)).toBe(true);
    expect(await app.correct("drafts-sealed", state.tokens.drafts_scoped as string)).toBe(true);
    expect(await app.correct("exposure-signoff", state.readyToken as string)).toBe(true);
  });

  it("should reject an empty, truncated or extended submission on every checkpoint", async () => {
    const state = await app.posture();
    const answers: Record<string, string> = {
      "exposed-record": mark,
      "admin-sealed": state.tokens.admin_sealed as string,
      "drafts-sealed": state.tokens.drafts_scoped as string,
      "exposure-signoff": state.readyToken as string,
    };
    for (const check of metadata.scoring.checks) {
      const right = answers[check.id] as string;
      expect(right).toBeTruthy();
      expect(await app.correct(check.id, "")).toBe(false);
      expect(await app.correct(check.id, "   ")).toBe(false);
      expect(await app.correct(check.id, right.slice(0, -1))).toBe(false);
      expect(await app.correct(check.id, `${right}x`)).toBe(false);
      // ...and the true answer still passes, so the four above are not passing
      // merely because the checkpoint rejects everything.
      expect(await app.correct(check.id, right)).toBe(true);
    }
  });

  it("should never credit one checkpoint's earned value to another", async () => {
    const state = await app.posture();
    const earned: Record<string, string> = {
      "exposed-record": mark,
      "admin-sealed": state.tokens.admin_sealed as string,
      "drafts-sealed": state.tokens.drafts_scoped as string,
      "exposure-signoff": state.readyToken as string,
    };
    for (const [owner, value] of Object.entries(earned)) {
      for (const check of metadata.scoring.checks) {
        if (check.id === owner) continue;
        expect(`${check.id}<-${owner}: ${await app.correct(check.id, value)}`).toBe(`${check.id}<-${owner}: false`);
      }
    }
    // The receipts for the three gates nothing asks for are refused everywhere.
    for (const gate of ["service_intact", "drafts_usable", "admin_available"] as Gate[]) {
      for (const check of metadata.scoring.checks) {
        expect(await app.correct(check.id, state.tokens[gate] as string)).toBe(false);
      }
    }
    // ...and the predecessor's handover reference, which is a real seed-derived
    // value the admin surface hands out, is not the answer to anything.
    for (const check of metadata.scoring.checks) {
      if (check.id === "exposed-record") continue;
      expect(await app.correct(check.id, handoverMark)).toBe(false);
    }
    expect(await app.correct("exposed-record", handoverMark)).toBe(false);
  });

  it("should refuse the admin receipt the app is emitting while the admin cannot get in", async () => {
    // The pin the catalog has been burned by: the negative half is satisfied by
    // denying the admin routes to everybody, and `/posture` keeps emitting the
    // receipt for that gate because it really is true. A checkpoint that only
    // compared the receipt would award 50 points for an outage.
    const earned = (await app.posture()).tokens.admin_sealed as string;
    app.writePolicy(referencePolicy({ without: ["admins-only"] }));

    const state = await app.posture();
    expect(state.gates.admin_sealed).toBe(true);
    expect(state.gates.admin_available).toBe(false);
    expect(state.tokens.admin_sealed).toBe(earned);
    expect(await app.correct("admin-sealed", earned)).toBe(false);
    expect(await app.correct("exposure-signoff", state.readyToken ?? "")).toBe(false);

    app.writePolicy(referencePolicy());
    expect(await app.correct("admin-sealed", earned)).toBe(true);
  });

  it("should refuse the drafts receipt the app is emitting while a shared document is unreadable", async () => {
    // The same pin on the other checkpoint: over-correcting to owner-only closes
    // the leak, so `drafts_scoped` stays true and its receipt keeps being
    // emitted. The value is harvested from the app in the state where it must
    // not be accepted, not invented.
    app.writePolicy(referencePolicy({ without: ["team-draft"] }));
    const state = await app.posture();
    expect(state.gates.drafts_scoped).toBe(true);
    expect(state.gates.service_intact).toBe(false);
    const earned = state.tokens.drafts_scoped as string;
    expect(earned).toMatch(/^TC\{drafts_scoped_[0-9a-f]{16}\}$/);
    expect(await app.correct("drafts-sealed", earned)).toBe(false);

    app.writePolicy(referencePolicy());
    expect((await app.posture()).tokens.drafts_scoped).toBe(earned);
    expect(await app.correct("drafts-sealed", earned)).toBe(true);
  });

  it("should stop accepting a sign-off captured while green once the document is reverted", async () => {
    const token = (await app.posture()).readyToken as string;
    app.writePolicyRaw(readFileSync(join(PROBLEM_DIR, "local", "access", "access.json"), "utf8"));
    const reverted = await app.posture();
    expect(reverted.ready).toBe(false);
    expect(reverted.readyToken).toBeNull();
    expect(await app.correct("exposure-signoff", token)).toBe(false);
    expect(await app.correct("admin-sealed", "anything")).toBe(false);

    app.writePolicy(referencePolicy());
    expect(await app.correct("exposure-signoff", token)).toBe(true);
  });

  it("should answer a checkpoint the same way twice, with nothing changed in between", async () => {
    const before = (await app.get("/portal/admin/drafts", "cto-daichi")).body.drafts as Array<{ id: string }>;
    const token = (await app.posture()).readyToken as string;
    for (const submission of ["", "nonsense", token, token, token]) {
      await app.answer("exposure-signoff", submission);
      await app.answer("drafts-sealed", submission);
      await app.answer("admin-sealed", submission);
    }
    const after = (await app.get("/portal/admin/drafts", "cto-daichi")).body.drafts as Array<{ id: string }>;
    expect(after.map((draft) => draft.id).sort()).toEqual(before.map((draft) => draft.id).sort());
  });

  it("should leave no probe document behind, however often the panel is polled", async () => {
    // The gate probes write. Being synchronous is what makes that invisible —
    // and a leftover would show up here as a document the participant never
    // wrote.
    for (let poll = 0; poll < 12; poll += 1) {
      await app.posture();
      await app.review();
    }
    const all = (await app.get("/portal/admin/drafts", "cto-daichi")).body.drafts as Array<{ id: string; title: string }>;
    expect(all).toHaveLength(4);
    expect(all.some((draft) => draft.title.includes("exposure review probe"))).toBe(false);
  });

  it("should probe on the port the app was told to listen on", async () => {
    // Deliberately not the default 8080. A checkpoint that probed a constant
    // port would answer false for every submission including the true one, and
    // only a participant would ever find out.
    expect(instance.board).toBe("http://127.0.0.1:18328");
    expect(await app.correct("exposure-signoff", (await app.posture()).readyToken as string)).toBe(true);
  });

  it("should send real requests to all three surfaces while answering the sign-off", async () => {
    // The gates already exercise the handler in-process. What they cannot see is
    // whether the routes are mounted and the board's dispatcher reaches them, so
    // every checkpoint sends real requests — and the decision record is where
    // that shows up, because gate probes are deliberately not recorded and real
    // requests are. Without this, dropping the live probes changes no verdict in
    // this file and the checkpoints quietly stop testing the socket.
    const mark = (await app.get("/portal/admin/audit", "cto-daichi")).body.nextSeq as number;
    expect(await app.correct("exposure-signoff", (await app.posture()).readyToken as string)).toBe(true);
    const audit = await app.get("/portal/admin/audit", "cto-daichi");
    const since = (audit.body.decisions as Array<{ seq: number; subject: string | null; method: string; path: string; effect: string }>)
      .filter((entry) => entry.seq >= mark);
    const saw = (subject: string | null, path: string, effect: string) =>
      since.some((entry) => entry.subject === subject && entry.path === path && entry.effect === effect);
    // healthAnswers()
    expect(saw(null, "/portal/healthz", "allow")).toBe(true);
    // draftSurfaceAnswers()
    expect(saw("sre-anzu", "/portal/draft", "deny")).toBe(true);
    expect(saw("mika-hoshino", "/portal/draft", "allow")).toBe(true);
    // adminSurfaceAnswers()
    expect(saw("cto-daichi", "/portal/admin/handover", "allow")).toBe(true);
    expect(saw(null, "/portal/admin/audit", "deny")).toBe(true);
    // ...and the gate probes are NOT in there: they run dozens of requests per
    // evaluation and recording them would evict the participant's own history.
    expect(since.some((entry) => entry.method === "POST")).toBe(false);
  });

  it("should require the decision record to hold a refusal it made a moment earlier", async () => {
    // "an array came back" is satisfied by an empty one, and the participant
    // does not write the ring — so the precondition has to name a decision the
    // checkpoint itself caused.
    const audit = await app.get("/portal/admin/audit", "cto-daichi");
    const decisions = audit.body.decisions as Array<{ subject: string | null; path: string; effect: string }>;
    expect(
      decisions.some((entry) => entry.subject === null && entry.path === "/portal/admin/audit" && entry.effect === "deny"),
    ).toBe(true);
  });

  it("should keep the customer's marking off every surface that is not the document itself", async () => {
    // A value a participant can read off the board would not be a discovery.
    for (const path of ["/", "/api/board", "/api/logs?limit=500", "/posture", "/portal", "/portal/review", "/healthz"]) {
      expect((await app.get(path)).text).not.toContain(mark);
    }
    // ...and it is in no committed file either.
    for (const file of ["metadata.json", "README.md", "README.ja.md", join("local", "access", "access.json")]) {
      expect(readFileSync(join(PROBLEM_DIR, file), "utf8")).not.toContain(mark);
    }
    expect(readFileSync(SCENARIO_FILE, "utf8")).not.toContain(mark);
  });

  it("should still reach the marking through the admin route after the door is closed", async () => {
    // Order independence: a participant who fixes the policy before reading the
    // evidence must not be locked out of the discovery checkpoint.
    const all = await app.get("/portal/admin/drafts", "cto-daichi");
    expect(all.status).toBe(200);
    expect(all.text).toContain(mark);
    expect((await app.get(`/portal/draft?id=${ids["hoshino-contract"]}`, "sre-anzu")).status).toBe(403);
  });
  /**
   * One case per row of the READMEs' shortcut table. Each writes the shortcut,
   * asserts the gate vector it produces and that the named checkpoints refuse
   * even the receipts the app is emitting at that moment — then restores the
   * reference policy and asserts it passes again, so each case proves the
   * checkpoint *discriminates* rather than merely rejecting.
   *
   * Nested rather than standalone so it shares the instance above: the suite has
   * ten ports to itself and five apps already running on them.
   */
  describe("shortcuts that must not pass", () => {
  /** Every receipt the app is emitting right now, plus the sign-off. */
  async function everythingOnOffer() {
    const state = await app.posture();
    return [...Object.values(state.tokens), state.readyToken].filter(
      (value): value is string => typeof value === "string",
    );
  }

  /**
   * The receipts the app emits while the reference policy is in place.
   *
   * `everythingOnOffer()` alone is not enough to state the property. Under a
   * shortcut that closes every gate the app emits nothing, `offered` comes back
   * empty, and the loop below then runs zero times and asserts nothing at all —
   * which is what the source-address case was doing: green, checking nothing.
   *
   * A receipt is bound to the state that produced it (see "should stop
   * accepting a sign-off captured while green"), so these are the submissions a
   * participant who reached green and then broke something would actually have
   * in hand, and refusing them is the property each case means to claim. They
   * are non-empty by construction, so the loop can no longer be vacuous.
   */
  let greenReceipts: string[] = [];

  beforeAll(async () => {
    app.writePolicy(referencePolicy());
    const green = await app.posture();
    expect(green.ready).toBe(true);
    greenReceipts = [...Object.values(green.tokens), green.readyToken].filter(
      (value): value is string => typeof value === "string",
    );
    expect(greenReceipts.length).toBeGreaterThan(0);
  });

  async function expectRefused(checkpoints: string[]) {
    const offered = [...new Set([...greenReceipts, ...(await everythingOnOffer())])];
    for (const checkpoint of checkpoints) {
      for (const value of offered) {
        expect(`${checkpoint}: ${await app.correct(checkpoint, value)}`).toBe(`${checkpoint}: false`);
      }
    }
  }

  async function expectRestored() {
    app.writePolicy(referencePolicy());
    const state = await app.posture();
    expect(state.ready).toBe(true);
    expect(await app.correct("admin-sealed", state.tokens.admin_sealed as string)).toBe(true);
    expect(await app.correct("drafts-sealed", state.tokens.drafts_scoped as string)).toBe(true);
    expect(await app.correct("exposure-signoff", state.readyToken as string)).toBe(true);
  }

  it("should refuse a policy that just closes everything", async () => {
    app.writePolicy({ defaultEffect: "deny", rules: [] });
    const gates = await app.gates();
    expect(gates.service_intact).toBe(false);
    expect(gates.drafts_usable).toBe(false);
    expect(gates.admin_available).toBe(false);
    await expectRefused(["admin-sealed", "drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse authentication offered as if it were authorization", async () => {
    app.writePolicy({
      defaultEffect: "deny",
      rules: [
        REFERENCE_RULES["monitoring-is-public"] as Rule,
        { id: "logged-in", effect: "allow", methods: ["*"], path: "*", require: ["authenticated"] },
      ],
    });
    const gates = await app.gates();
    // Everything works. Nothing that must be refused is refused, because every
    // probe that must be refused holds a key this app issued.
    expect(gates.service_intact).toBe(true);
    expect(gates.drafts_usable).toBe(true);
    expect(gates.drafts_scoped).toBe(false);
    expect(gates.admin_sealed).toBe(false);
    await expectRefused(["admin-sealed", "drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse a policy pinned to one known-good user", async () => {
    app.writePolicy(
      referencePolicy({
        replace: {
          "who-am-i": { id: "who-am-i", effect: "allow", methods: ["GET"], path: "/portal/me", require: ["subject:sre-anzu"] },
        },
      }),
    );
    expect((await app.gates()).service_intact).toBe(false);
    await expectRefused(["drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse coarse tenant scoping on the documents", async () => {
    app.writePolicy(
      referencePolicy({
        replace: {
          "own-draft": {
            id: "own-draft",
            effect: "allow",
            methods: ["GET", "DELETE"],
            path: "/portal/draft",
            require: ["authenticated", "tenant"],
          },
        },
      }),
    );
    const gates = await app.gates();
    expect(gates.service_intact).toBe(true);
    expect(gates.drafts_scoped).toBe(false);
    await expectRefused(["drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse over-correcting to owner-only", async () => {
    app.writePolicy(referencePolicy({ without: ["team-draft"] }));
    const gates = await app.gates();
    expect(gates.drafts_scoped).toBe(true);
    expect(gates.service_intact).toBe(false);
    await expectRefused(["drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse an allowlist of the ids that were visible while exploring", async () => {
    const ids = await app.ids();
    app.writePolicy(
      referencePolicy({
        replace: {
          "own-draft": {
            id: "own-draft",
            effect: "allow",
            methods: ["GET", "DELETE"],
            // Not expressible as a path allowlist, so the nearest real attempt:
            // pin the decision to the subjects seen owning what was explored.
            path: "/portal/draft",
            require: ["subject:sre-anzu"],
          },
        },
      }),
    );
    expect(Object.keys(ids)).toHaveLength(4);
    const gates = await app.gates();
    expect(gates.drafts_usable).toBe(false);
    expect(gates.service_intact).toBe(false);
    await expectRefused(["drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse a policy that closes the admin reads and forgets the admin write", async () => {
    // The whole admin tree is four routes and one of them is destructive. A
    // policy that seals the three GETs and leaves DELETE open to anybody looks
    // finished on every read-shaped probe. It is caught because a refusal is
    // exactly 401 or 403 — an open route answering 404 for an id that never
    // existed is a different answer, and the probes compare the number rather
    // than its shape.
    app.writePolicy({
      defaultEffect: "deny",
      rules: [
        { id: "delete-left-open", effect: "allow", methods: ["DELETE"], path: "/portal/admin/*", require: [] },
        ...referencePolicy().rules,
      ],
    });
    const review = await app.review();
    const leaks = review.groups.admin_sealed.probes.filter((probe) => !probe.ok);
    expect(leaks.length).toBe(5);
    for (const probe of leaks) {
      expect(probe.name).toContain("removes a document through the admin route");
      expect(probe.got).toBe("404");
      expect(probe.decidedBy).toBe("delete-left-open");
    }
    const gates = await app.gates();
    expect(gates.admin_sealed).toBe(false);
    expect(gates.admin_available).toBe(true);
    expect(gates.drafts_scoped).toBe(true);
    await expectRefused(["admin-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse a policy that closes the monitoring path", async () => {
    app.writePolicy(referencePolicy({ without: ["monitoring-is-public"] }));
    const gates = await app.gates();
    expect(gates.service_intact).toBe(false);
    expect(gates.drafts_scoped).toBe(true);
    expect(gates.admin_sealed).toBe(true);
    await expectRefused(["drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse a source-address condition rather than deciding nothing with it", async () => {
    app.writePolicy({
      defaultEffect: "deny",
      rules: [{ id: "loopback", effect: "allow", methods: ["*"], path: "*", require: ["client-ip:127.0.0.1/32"] }],
    });
    const gates = await app.gates();
    expect(Object.values(gates).every((value) => value === false)).toBe(true);
    await expectRefused(["admin-sealed", "drafts-sealed", "exposure-signoff"]);
    await expectRestored();
  });

  it("should refuse hiding the leak by deleting the document that leaks", async () => {
    const ids = await app.ids();
    expect((await app.remove(`/portal/admin/draft?id=${ids["hoshino-contract"]}`, "cto-daichi")).status).toBe(200);
    const gates = await app.gates();
    expect(gates.service_intact).toBe(false);
    expect(gates.admin_available).toBe(false);
    await expectRefused(["admin-sealed", "drafts-sealed", "exposure-signoff"]);
    // Not restorable: the document is gone for this instance, which is exactly
    // the cost. Asserted so the case cannot be mistaken for a recoverable one.
    app.writePolicy(referencePolicy());
    const after = await app.gates();
    expect(after.service_intact).toBe(false);
    expect(after.admin_available).toBe(false);
  });
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure policy grammar", () => {
  /**
   * The decision function, called directly. Not a second implementation — it is
   * the same `decide` every request goes through — but the semantics the READMEs
   * and the console commit to in writing are not all observable through the app:
   * there is no route at `/portal/admin`, so whether `/portal/admin/*` covers it
   * can only be pinned here. A documented rule nothing can falsify is a rule
   * that drifts.
   */
  let engine: {
    decide(policy: Policy, request: { method: string; path: string; principal: unknown; object: unknown }): { effect: string; ruleId: string };
    validatePolicy(raw: unknown): { ok: boolean; problems: string[] };
  };

  beforeAll(async () => {
    engine = (await import("../stackstack-base/app/scenarios/safe-exposure.mjs")) as unknown as typeof engine;
  });

  const anzu = { subject: "sre-anzu", tenant: "tenka", role: "member" };
  const rule = (path: string, methods: string[] = ["*"], require: string[] = []): Rule => ({
    id: "under-test",
    effect: "allow",
    methods,
    path,
    require,
  });
  const ask = (rules: Rule[], method: string, path: string, principal: unknown = null, object: unknown = null) =>
    engine.decide({ defaultEffect: "deny", rules }, { method, path, principal, object });

  it("should match a path exactly unless it ends in a trailing wildcard", () => {
    expect(ask([rule("/portal/me")], "GET", "/portal/me").effect).toBe("allow");
    expect(ask([rule("/portal/me")], "GET", "/portal/mex").effect).toBe("deny");
    expect(ask([rule("/portal/me")], "GET", "/portal/me/x").effect).toBe("deny");
  });

  it("should cover longer paths with a trailing wildcard, and never the prefix itself", () => {
    const rules = [rule("/portal/admin/*")];
    expect(ask(rules, "GET", "/portal/admin/audit").effect).toBe("allow");
    expect(ask(rules, "DELETE", "/portal/admin/draft").effect).toBe("allow");
    expect(ask(rules, "GET", "/portal/admin/deeper/still").effect).toBe("allow");
    // The claim the console and both READMEs make in writing. There is no route
    // at this path today, so nothing else in this suite can hold it.
    expect(ask(rules, "GET", "/portal/admin").effect).toBe("deny");
    expect(ask(rules, "GET", "/portal/administrator").effect).toBe("deny");
  });

  it("should treat a bare star as every path", () => {
    expect(ask([rule("*")], "GET", "/portal/anything").effect).toBe("allow");
    expect(ask([rule("*")], "DELETE", "/portal/draft").effect).toBe("allow");
  });

  it("should honour the method list, and a star inside it", () => {
    expect(ask([rule("/portal/draft", ["GET"])], "GET", "/portal/draft").effect).toBe("allow");
    expect(ask([rule("/portal/draft", ["GET"])], "DELETE", "/portal/draft").effect).toBe("deny");
    expect(ask([rule("/portal/draft", ["*"])], "DELETE", "/portal/draft").effect).toBe("allow");
  });

  it("should let the first rule whose requirements all hold decide, and skip the rest", () => {
    const rules: Rule[] = [
      { id: "first", effect: "deny", methods: ["GET"], path: "/portal/draft", require: ["anonymous"] },
      { id: "second", effect: "allow", methods: ["GET"], path: "/portal/draft", require: ["authenticated"] },
    ];
    expect(ask(rules, "GET", "/portal/draft", null)).toEqual({ effect: "deny", ruleId: "first" });
    expect(ask(rules, "GET", "/portal/draft", anzu)).toEqual({ effect: "allow", ruleId: "second" });
  });

  it("should fall through a rule whose path matches but whose requirements do not", () => {
    // The property two rules on one path depend on. If a path match alone ended
    // evaluation, "mine, or shared with my tenant" could not be written.
    const rules: Rule[] = [
      { id: "owner-rule", effect: "allow", methods: ["GET"], path: "/portal/draft", require: ["owner"] },
      { id: "shared-rule", effect: "allow", methods: ["GET"], path: "/portal/draft", require: ["tenant", "shared"] },
    ];
    const runbook = { owner: "pm-kenji", tenant: "tenka", visibility: "team" };
    expect(ask(rules, "GET", "/portal/draft", anzu, runbook)).toEqual({ effect: "allow", ruleId: "shared-rule" });
  });

  it("should hold owner, tenant and shared false where there is no object", () => {
    for (const requirement of ["owner", "tenant", "shared"]) {
      expect(ask([rule("/portal/drafts", ["GET"], [requirement])], "GET", "/portal/drafts", anzu).effect).toBe("deny");
    }
  });

  it("should treat an empty requirement list as no requirement rather than as a refusal", () => {
    expect(ask([rule("/portal/healthz", ["GET"], [])], "GET", "/portal/healthz", null)).toEqual({
      effect: "allow",
      ruleId: "under-test",
    });
  });

  it("should fall to defaultEffect when no rule matches, and name it", () => {
    expect(engine.decide({ defaultEffect: "allow", rules: [] }, { method: "GET", path: "/x", principal: null, object: null })).toEqual({
      effect: "allow",
      ruleId: "default",
    });
    expect(engine.decide({ defaultEffect: "deny", rules: [] }, { method: "GET", path: "/x", principal: null, object: null })).toEqual({
      effect: "deny",
      ruleId: "default",
    });
  });

  it("should name every problem in a document rather than stopping at the first", () => {
    const checked = engine.validatePolicy({
      defaultEffect: "maybe",
      rules: [{ effect: "grant", methods: "GET", path: "", require: ["client-ip:0.0.0.0/0"] }],
    });
    expect(checked.ok).toBe(false);
    expect(checked.problems.length).toBeGreaterThanOrEqual(4);
    expect(checked.problems.join(" ")).toContain("defaultEffect");
    expect(checked.problems.join(" ")).toContain("effect");
    expect(checked.problems.join(" ")).toContain("methods");
    expect(checked.problems.join(" ")).toContain("path");
    expect(checked.problems.join(" ")).toContain("source-address");
  });

  it("should accept the reference policy and the shipped one", () => {
    expect(engine.validatePolicy(referencePolicy()).ok).toBe(true);
    const shipped = JSON.parse(readFileSync(join(PROBLEM_DIR, "local", "access", "access.json"), "utf8"));
    expect(engine.validatePolicy(shipped).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-safe-exposure wiring", () => {
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

  it("should publish every challenge endpoint's port, on loopback only", () => {
    for (const url of Object.values(metadata.runtime.challengeEndpoints)) {
      expect(service.ports).toContain(`127.0.0.1:${new URL(url).port}:8080`);
    }
    for (const published of service.ports) expect(published.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should publish the verify port on loopback only", () => {
    expect(service.ports).toContain(`127.0.0.1:${new URL(metadata.runtime.verifyUrl).port}:8081`);
  });

  it("should declare exactly the ports it publishes", () => {
    const published = [...new Set(service.ports.map((entry) => Number(entry.split(":")[1])))].sort((a, b) => a - b);
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    expect(existsSync(join(composeDir, service.build.context, service.build.dockerfile))).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("safe-exposure");
    expect(existsSync(join(composeDir, service.build.context, "app", "scenarios", "safe-exposure.mjs"))).toBe(true);
  });

  it("should mount both participant-owned directories read-only", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro", "./access:/app/access:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "access", "access.json"))).toBe(true);
  });

  it("should name both files as the participant sees them, from the platform checkout", () => {
    for (const [hint, inThisRepo] of [
      [service.environment.ACCESS_HINT, "challenges/stackstack-safe-exposure/local/access/access.json"],
      [service.environment.CONFIG_HINT, "challenges/stackstack-safe-exposure/local/config/app.json"],
    ] as const) {
      expect(hint).toBe(`problems/${inThisRepo}`);
      expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
    }
  });

  it("should mount the access document where the app reads it with no override", () => {
    // The compose file passes no ACCESS_POLICY, so the app's default path and
    // the mount target have to be the same string or the container boots with no
    // document at all.
    expect(readFileSync(SCENARIO_FILE, "utf8")).toContain('process.env.ACCESS_POLICY ?? "/app/access/access.json"');
    expect(service.volumes).toContain("./access:/app/access:ro");
  });

  it("should direct participant-facing docs to the runtime access API", () => {
    for (const name of ["README.md", "README.ja.md"]) {
      expect(readFileSync(join(PROBLEM_DIR, name), "utf8")).toContain("PATCH /api/settings");
    }
    expect(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")).toContain("PATCH /api/settings");
  });

  it("should ship a document that is open, with one rule as a worked example", () => {
    const shipped = JSON.parse(readFileSync(join(PROBLEM_DIR, "local", "access", "access.json"), "utf8")) as Policy;
    expect(shipped.defaultEffect).toBe("allow");
    expect(shipped.rules).toHaveLength(1);
    expect(shipped.rules[0]).toEqual(REFERENCE_RULES["monitoring-is-public"] as Rule);
  });

  it("should ship a board config this problem is not about", () => {
    const config = JSON.parse(readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8")) as {
      acceptingPosts: boolean;
    };
    expect(config.acceptingPosts).toBe(true);
  });

  it("should ship a diagram the portal can render", () => {
    const diagram = readFileSync(join(PROBLEM_DIR, "diagram.svg"), "utf8");
    expect(diagram.startsWith("<svg")).toBe(true);
    expect(diagram).not.toContain("TC{");
  });

  it("should keep the two READMEs materially equivalent", () => {
    // AGENT.md §1a: equivalent in story, deployment model, play flow, scoring
    // and cost. Checked on the load-bearing facts rather than by translation.
    const english = readFileSync(join(PROBLEM_DIR, "README.md"), "utf8");
    const japanese = readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8");
    for (const anchor of [
      "make local PROBLEM=stackstack-safe-exposure",
      "DELETE /api/settings",
      "127.0.0.1:18080/portal",
      "127.0.0.1:18081",
      "GET /portal/review",
      "DELETE /portal/admin/draft?id=…",
      "client-ip:",
      "PATCH /api/settings",
      "4 / 9",
      "5 / 7 / 11",
      "6 / 9 / 13",
      "8 / 15",
      "87",
    ]) {
      expect(english).toContain(anchor);
      expect(japanese).toContain(anchor);
    }
    for (const points of metadata.scoring.checks.map((check) => String(check.points))) {
      expect(english).toContain(points);
      expect(japanese).toContain(points);
    }
  });

  it("should say in both READMEs that the board itself is outside the document's reach", () => {
    // The one claim this problem could easily overstate. It is written down in
    // both languages, and the 認証 suite asserts it is true.
    expect(readFileSync(join(PROBLEM_DIR, "README.md"), "utf8")).toContain(
      "The board itself is outside the document's reach",
    );
    expect(readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8")).toContain(
      "板そのものは access ドキュメントの管轄外",
    );
  });

  it("should admit in both READMEs that the reference policy is committed here", () => {
    expect(readFileSync(join(PROBLEM_DIR, "README.md"), "utf8")).toContain(
      "scripts/stackstack-safe-exposure.test.ts",
    );
    expect(readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8")).toContain(
      "scripts/stackstack-safe-exposure.test.ts",
    );
  });
});
