import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-observability grades an investigation, so the thing that must never
 * break is that every verdict comes from the app's *current* measured state —
 * not from a value the participant once saw, and not from the absence of
 * evidence nobody ever produced.
 *
 * These tests drive the real app over real HTTP. They are organised around one
 * question per checkpoint: **can the earned answer be accepted in a state where
 * it must not be?** For each of the four, the suite harvests the genuine value
 * out of a solved instance and then submits that genuine value into a state that
 * has to refuse it — logging switched back off, the health condition loosened
 * again, the credential back in the line, a shard that is not the one that is
 * down, a container that has not seen a single write. Guesses failing proves
 * only that guessing fails.
 *
 * Config files are copied to a scratch directory first: these tests edit them
 * the way a participant does, and must not leave the repository's shipped files
 * flipped.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-observability");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "observability.mjs");

/** 18340-18349, reserved for this problem so a `make local` session cannot collide. */
const CHALLENGE_PORT = 18340;
const VERIFY_PORT = 18341;
const BOARD = `http://127.0.0.1:${CHALLENGE_PORT}`;
const VERIFY = `http://127.0.0.1:${VERIFY_PORT}/verify`;
const SEED = "stackstack-observability-test-seed";
const OTHER_SEED = "stackstack-observability-other-seed";
const CONFIG_HINT = "problems/challenges/stackstack-observability/local/config/app.json";
const RELAY_HINT = "problems/challenges/stackstack-observability/local/relay/relay.json";

const SHIPPED_RELAY = {
  archiveLogging: "off",
  healthCheckProbes: ["config"],
  logDetail: "full",
} as const;

const FIXED_RELAY = {
  archiveLogging: "on",
  healthCheckProbes: ["config", "archive"],
  logDetail: "safe",
} as const;

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

// ---------------------------------------------------------------------------
// a driveable instance
// ---------------------------------------------------------------------------

interface LogLine {
  readonly at: string;
  readonly level: string;
  readonly message: string;
}

class Instance {
  readonly base: string;
  readonly verify: string;
  readonly relayPath: string;
  readonly configPath: string;
  private process: ReturnType<typeof spawn> | undefined;
  private counter = 0;

  constructor(
    private readonly scratch: string,
    private readonly name: string,
    private readonly port: number,
    private readonly verifyPort: number,
  ) {
    this.base = `http://127.0.0.1:${port}`;
    this.verify = `http://127.0.0.1:${verifyPort}/verify`;
    this.relayPath = join(scratch, `${name}-relay.json`);
    this.configPath = join(scratch, `${name}-app.json`);
  }

  async start(options: { seed?: string; relay?: object; acceptingPosts?: boolean } = {}) {
    writeFileSync(this.relayPath, JSON.stringify(options.relay ?? SHIPPED_RELAY, null, 2));
    writeFileSync(
      this.configPath,
      JSON.stringify({ boardTitle: "board", acceptingPosts: options.acceptingPosts ?? true }, null, 2),
    );
    this.process = spawn("bun", [SERVER], {
      env: {
        ...process.env,
        SCENARIO: "observability",
        FLAG_SEED: options.seed ?? SEED,
        APP_CONFIG: this.configPath,
        RELAY_CONFIG: this.relayPath,
        CONFIG_HINT,
        RELAY_HINT,
        CHALLENGE_PORT: String(this.port),
        VERIFY_PORT: String(this.verifyPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Waited on through /verify's own /healthz, which is a flat {status:"ok"}
    // and independent of the scenario. The board's /healthz would also do, but
    // the *relay's* health check answers 503 once it is correct, so anything
    // that waited on a scenario predicate would hang on a solved instance.
    const deadline = Date.now() + 6_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${this.verifyPort}/healthz`)).ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`${this.name} never came up`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this;
  }

  stop() {
    this.process?.kill();
  }

  writeRelay(settings: unknown) {
    writeFileSync(this.relayPath, JSON.stringify(settings, null, 2));
  }

  writeConfig(patch: Record<string, unknown>) {
    const current = JSON.parse(readFileSync(this.configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(this.configPath, JSON.stringify({ ...current, ...patch }, null, 2));
  }

  async get(path: string): Promise<{ status: number; body: any; text: string }> {
    const response = await fetch(`${this.base}${path}`);
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body, text };
  }

  async post(payload: unknown) {
    const response = await fetch(`${this.base}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  async answer(checkpointId: string, submission: string) {
    const response = await fetch(this.verify, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId, submission, context: { teamId: "t", problemId: "p" } }),
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  async correct(checkpointId: string, submission: string): Promise<boolean> {
    return (await this.answer(checkpointId, submission)).body.correct === true;
  }

  async logs(): Promise<LogLine[]> {
    return ((await this.get("/api/logs?limit=400")).body.lines ?? []) as LogLine[];
  }

  async relayLines(): Promise<string[]> {
    return (await this.logs())
      .map((line) => line.message)
      .filter((message) => message.startsWith("relay archived ") || message.startsWith("relay drop "));
  }

  /** Relay lines written under the settings generation that is in force now. */
  async currentEpochRelayLines(): Promise<string[]> {
    const { epoch } = await this.state();
    return (await this.relayLines()).filter((line) => line.includes(` epoch=${epoch} `));
  }

  async metrics(): Promise<string> {
    return (await this.get("/metrics")).text;
  }

  async state(): Promise<any> {
    return (await this.get("/relay/state")).body;
  }

  async posture(): Promise<{
    gates: Record<string, boolean>;
    tokens: Record<string, string | null>;
    ready: boolean;
  }> {
    return (await this.get("/posture")).body;
  }

  /**
   * Post distinct titles until every shard has been written to and both a
   * delivered write and a dropped one have been recorded, confirmed through
   * `/metrics`.
   *
   * Titles are counter-derived and never reused, so this can be called after
   * every settings change without needing to know which title maps where — the
   * map is seed-derived, and a test that knew it would be asserting against a
   * table rather than against the app. Waiting for all four shards rather than
   * for "one of each outcome" is what keeps the suite deterministic: the codes
   * of the healthy shards are what several assertions here submit as values
   * that must be refused.
   */
  async generateSignal(): Promise<void> {
    // Measured as a delta from where this call started, not as a total. The
    // counters are cumulative across settings changes, so a call made right
    // after a settings edit has to produce fresh evidence under the *new*
    // settings rather than being satisfied by what the old ones recorded.
    const before = metricTotals(await this.metrics());
    for (let attempt = 0; attempt < 200; attempt += 1) {
      this.counter += 1;
      const posted = await this.post({
        author: "you",
        title: `${this.name}-note-${this.counter}`,
        body: "x",
      });
      expect(posted.status).toBe(201);
      if (attempt % 3 !== 2) continue;
      const metrics = await this.metrics();
      const now = metricTotals(metrics);
      if (
        shardSeries(metrics).length === 4 &&
        now.archived > before.archived &&
        now.dropped > before.dropped
      ) {
        return;
      }
    }
    throw new Error("no fresh delivered-and-dropped pair appeared after 200 titles");
  }

  async archiveCounts(): Promise<{ archived: number; dropped: number }> {
    const state = await this.state();
    return { archived: state.archive.archived, dropped: state.archive.dropped };
  }
}

let scratch = "";
let main: Instance;

/** Pull the value after `field=` out of the first line that carries it. */
function fieldFrom(lines: readonly string[], startsWith: string, field: string): string {
  const line = lines.find((entry) => entry.startsWith(startsWith) && entry.includes(`${field}=`));
  if (line === undefined) throw new Error(`no ${startsWith}… line carrying ${field}=`);
  return (line.split(`${field}=`)[1] as string).split(" ")[0] as string;
}

/** Every `shard`/`code` pair `/metrics` is currently publishing, with its up value. */
function shardSeries(metrics: string): Array<{ shard: string; code: string; up: number }> {
  return [...metrics.matchAll(/^relay_shard_up\{shard="([^"]+)",code="([^"]+)"\} ([01])$/gm)].map(
    (match) => ({ shard: match[1] as string, code: match[2] as string, up: Number(match[3]) }),
  );
}

/** Delivered and dropped write counts, summed over every shard `/metrics` names. */
function metricTotals(metrics: string): { archived: number; dropped: number } {
  const counted = { archived: 0, dropped: 0 };
  for (const match of metrics.matchAll(
    /^relay_posts_total\{result="(archived|dropped)",shard="[^"]+"\} (\d+)$/gm,
  )) {
    counted[match[1] as "archived" | "dropped"] += Number(match[2]);
  }
  return counted;
}

/** Attempt totals per shard, whatever the outcome. */
function shardAttempts(metrics: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of metrics.matchAll(
    /^relay_posts_total\{result="(?:archived|dropped)",shard="([^"]+)"\} (\d+)$/gm,
  )) {
    const shard = match[1] as string;
    counts.set(shard, (counts.get(shard) ?? 0) + Number(match[2]));
  }
  return counts;
}

/** Which shard one title lands on, measured by posting it and watching the counters. */
async function routeOf(instance: Instance, title: string): Promise<string> {
  const before = shardAttempts(await instance.metrics());
  expect((await instance.post({ author: "you", title, body: "x" })).status).toBe(201);
  const after = shardAttempts(await instance.metrics());
  const moved = [...after.entries()].filter(([shard, count]) => count !== (before.get(shard) ?? 0));
  expect(moved.length).toBe(1);
  return moved[0]?.[0] as string;
}

function droppedShards(metrics: string): string[] {
  return [...metrics.matchAll(/^relay_posts_total\{result="dropped",shard="([^"]+)"\} (\d+)$/gm)]
    .filter((match) => Number(match[2]) > 0)
    .map((match) => match[1] as string);
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-observability-"));
  main = await new Instance(scratch, "main", CHALLENGE_PORT, VERIFY_PORT).start();
});

afterAll(() => {
  main?.stop();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// scoring regulation
// ---------------------------------------------------------------------------

describe("stackstack-observability scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(200);
  });

  it("should spend the Medium tier's whole wrong-answer budget and no more", () => {
    // The validator only enforces the flat form; spread across checkpoints it
    // still has to add up to 5% of the base.
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

  it("should keep every participant-visible label off the vulnerability class", () => {
    // AGENT.md §10 / §13: labels name the symptom or the asset. "the log is
    // safe to hand over" is an asset; "credential leak" would be the finding.
    const labels = [
      ...metadata.scoring.checks.map((check) => check.label),
      ...metadata.i18n.en.checks.map((check) => check.label),
    ];
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(80);
      expect(label.toLowerCase()).not.toMatch(
        /credential|secret|leak|漏[洩え]|秘密|injection|xss|認証情報/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// the shipped state: the lie, and the silence
// ---------------------------------------------------------------------------

describe("stackstack-observability as it ships", () => {
  it("should ship the relay settings the problem is about, unfixed", () => {
    const shipped = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "relay", "relay.json"), "utf8"),
    ) as typeof SHIPPED_RELAY;
    expect(shipped).toEqual(SHIPPED_RELAY);
  });

  it("should ship the board open, because a closed board has no symptom", () => {
    const shipped = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    expect(shipped.acceptingPosts).toBe(true);
  });

  it("should answer 200 from the relay health check while the archive is down", async () => {
    // The whole initial condition in one assertion: the dashboard is green and
    // the dependency it is not looking at is not answering.
    const health = await main.get("/relay/healthz");
    expect(health.status).toBe(200);
    expect(health.body.probes).toEqual(["config"]);
    const metrics = await main.metrics();
    expect(metrics).toContain('relay_dependency_up{name="archive"} 0');
    expect(metrics).toContain('relay_dependency_up{name="config"} 1');
  });

  it("should keep the board's own health check at 200: the board is not what is broken", async () => {
    const health = await main.get("/healthz");
    expect(health.status).toBe(200);
  });

  it("should publish no per-shard breakdown before anything has been written", async () => {
    // The diagnosis has to be produced by the participant's own traffic. If the
    // codes were printed at boot, `root-cause` would be `curl | grep`.
    const metrics = await main.metrics();
    expect(shardSeries(metrics)).toEqual([]);
    expect(metrics).toContain("# TYPE relay_posts_total counter");
    expect(metrics).not.toMatch(/^relay_posts_total\{/m);
  });

  it("should have boot and post-accepted lines but nothing about a lost write", async () => {
    // The briefing says exactly this, and it has to be true against the shipped
    // settings: a participant who opens the log first must find it populated and
    // still find no line about the symptom.
    await main.post({ author: "you", title: "shipped-state-probe", body: "x" });
    const lines = await main.logs();
    expect(lines.some((line) => line.message.startsWith("boot ok boot-check="))).toBe(true);
    expect(lines.some((line) => line.message.startsWith("post accepted id="))).toBe(true);
    expect(await main.relayLines()).toEqual([]);
  });

  it("should still be counting the failures nobody is logging", async () => {
    await main.generateSignal();
    const counts = await main.archiveCounts();
    expect(counts.archived).toBeGreaterThan(0);
    expect(counts.dropped).toBeGreaterThan(0);
    // ...and the log is still silent about them.
    expect(await main.relayLines()).toEqual([]);
  });

  it("should keep a post on the board even when the archive refuses it", async () => {
    // The board is not what is failing. A participant who only reads the board
    // sees nothing wrong, which is why the CTO's report and the dashboard
    // disagree.
    const before = (await main.get("/api/board")).body.posts.length;
    await main.post({ author: "you", title: "board-keeps-this", body: "x" });
    const after = (await main.get("/api/board")).body.posts;
    expect(after.length).toBe(before + 1);
    expect(after.some((post: { title: string }) => post.title === "board-keeps-this")).toBe(true);
  });

  it("should send the same title to the same shard every time", async () => {
    // Determinism is what lets a participant prove to themselves that a restart
    // changes nothing. It is also why a title cannot be named in a hint.
    const first = await main.metrics();
    const before = new Map(
      [...first.matchAll(/^relay_posts_total\{result="(\w+)",shard="([^"]+)"\} (\d+)$/gm)].map(
        (match) => [`${match[1]}|${match[2]}`, Number(match[3])],
      ),
    );
    for (let repeat = 0; repeat < 3; repeat += 1) {
      await main.post({ author: "you", title: "repeatable-title", body: "x" });
    }
    const after = new Map(
      [...(await main.metrics()).matchAll(/^relay_posts_total\{result="(\w+)",shard="([^"]+)"\} (\d+)$/gm)].map(
        (match) => [`${match[1]}|${match[2]}`, Number(match[3])],
      ),
    );
    const moved = [...after.entries()].filter(([key, value]) => value !== (before.get(key) ?? 0));
    expect(moved.length).toBe(1);
    expect(moved[0]?.[1]).toBe((before.get(moved[0]?.[0] as string) ?? 0) + 3);
  });

  it("should leave exactly one shard down, so 'everything is broken' is not the diagnosis", async () => {
    const metrics = await main.metrics();
    const series = shardSeries(metrics);
    expect(series.length).toBe(4);
    expect(series.filter((entry) => entry.up === 0).length).toBe(1);
    expect(new Set(series.map((entry) => entry.code)).size).toBe(4);
    for (const entry of series) expect(entry.code).toMatch(/^[0-9a-f]{8}$/);
    expect(droppedShards(metrics)).toEqual([
      series.find((entry) => entry.up === 0)?.shard as string,
    ]);
  });

  it("should refuse every checkpoint in the shipped state, however much traffic ran", async () => {
    // Traffic alone is not a solve. Nothing has been configured, so nothing is
    // recorded and nothing is honest.
    for (const check of metadata.scoring.checks) {
      expect(await main.correct(check.id, "anything")).toBe(false);
    }
    const posture = await main.posture();
    expect(posture.gates).toEqual({
      traffic_seen: true,
      failures_logged: false,
      health_honest: false,
      credential_out_of_logs: false,
    });
    expect(posture.tokens.health_honest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the relay's settings file
// ---------------------------------------------------------------------------

describe("stackstack-observability relay settings", () => {
  afterAll(() => main.writeRelay(SHIPPED_RELAY));

  it("should refuse a misspelled key rather than ignoring it", async () => {
    main.writeRelay({ ...SHIPPED_RELAY, archiveLoging: "on" });
    const health = await main.get("/relay/healthz");
    expect(health.status).toBe(503);
    expect(health.body.error).toBe("relay_settings_invalid");
    expect(health.body.detail).toContain("archiveLoging");
    expect((await main.metrics())).toContain("relay_settings_ok 0");
  });

  it("should refuse a value outside the settings it accepts", async () => {
    main.writeRelay({ ...SHIPPED_RELAY, logDetail: "none" });
    const health = await main.get("/relay/healthz");
    expect(health.status).toBe(503);
    expect(health.body.detail).toContain("logDetail must be one of full|masked|minimal|safe");
  });

  it("should reject an unknown dependency name without enumerating the real ones", async () => {
    // A deliberate typo must not buy the answer to `honest-health`. The names
    // live on /metrics and nowhere else.
    main.writeRelay({ ...SHIPPED_RELAY, healthCheckProbes: ["config", "nope"] });
    const health = await main.get("/relay/healthz");
    expect(health.status).toBe(503);
    const detail = health.body.detail as string;
    expect(detail).toContain('healthCheckProbes[1] "nope" is not a dependency this relay has');
    expect(detail).not.toContain("archive");
  });

  it("should keep relaying traffic while its settings are broken, and say so", async () => {
    // Losing the participant's counters over a typo would be a trap; losing the
    // signal is the honest consequence.
    main.writeRelay({ ...SHIPPED_RELAY, healthCheckProbes: ["nope"] });
    const before = await main.archiveCounts();
    await main.post({ author: "you", title: "broken-settings-traffic", body: "x" });
    const after = await main.archiveCounts();
    expect(after.archived + after.dropped).toBe(before.archived + before.dropped + 1);
    const logs = await main.logs();
    expect(logs.some((line) => line.message.includes("relay config epoch=") && line.message.includes("rejected:"))).toBe(true);
  });

  it("should take a corrected settings file with no restart", async () => {
    main.writeRelay(SHIPPED_RELAY);
    const health = await main.get("/relay/healthz");
    expect(health.status).toBe(200);
    expect((await main.metrics())).toContain("relay_settings_ok 1");
  });
});

// ---------------------------------------------------------------------------
// the health condition, enumerated
// ---------------------------------------------------------------------------

describe("stackstack-observability health condition", () => {
  const port = 18342;
  const verifyPort = 18343;
  let instance: Instance;

  beforeAll(async () => {
    instance = await new Instance(scratch, "health", port, verifyPort).start();
    await instance.generateSignal();
  });

  afterAll(() => instance.stop());

  /** Every subset of this relay's dependencies, and what each one is worth. */
  const subsets: Array<{ probes: string[]; honest: boolean; why: string }> = [
    { probes: [], honest: false, why: "always 503: a check that looks at nothing can never say yes" },
    { probes: ["config"], honest: false, why: "the shipped condition: blind to the archive" },
    { probes: ["archive"], honest: false, why: "blind to its own settings file" },
    { probes: ["config", "archive"], honest: true, why: "the only condition right in all three worlds" },
  ];

  for (const subset of subsets) {
    it(`should rate healthCheckProbes=[${subset.probes.join(",")}] as ${subset.honest ? "honest" : "not honest"} (${subset.why})`, async () => {
      instance.writeRelay({ ...FIXED_RELAY, healthCheckProbes: subset.probes });
      await instance.get("/relay/healthz");
      const state = await instance.state();
      expect(state.health.honest).toBe(subset.honest);
      expect((await instance.posture()).gates.health_honest).toBe(subset.honest);
    });
  }

  it("should refuse a health check nailed shut, red or green", async () => {
    // The two fixed-response shortcuts, both expressible here and both refused.
    // An empty probe list is "always 503, so I can never miss an outage": it is
    // never green, which is what the third world exists to catch. Pointing it
    // only at the dependency that cannot fail is the shipped condition, which is
    // never red. Neither is a health check.
    instance.writeRelay({ ...FIXED_RELAY, healthCheckProbes: [] });
    await instance.get("/relay/healthz");
    expect((await instance.get("/relay/healthz")).status).toBe(503);
    expect((await instance.state()).health.honest).toBe(false);

    instance.writeRelay({ ...FIXED_RELAY, healthCheckProbes: ["config"] });
    expect((await instance.get("/relay/healthz")).status).toBe(200);
    expect((await instance.state()).health.honest).toBe(false);
  });

  it("should turn the corrected health check red, because the archive really is down", async () => {
    // The point of the checkpoint. A health check that has never gone red has
    // not been shown to work — it has been shown to watch something that cannot
    // fail. Pinned rather than tripped over.
    instance.writeRelay(FIXED_RELAY);
    const health = await instance.get("/relay/healthz");
    expect(health.status).toBe(503);
    expect(health.body.checks).toEqual({ config: true, archive: false });
  });

  it("should not raise the gate on a corrected condition nobody has run", async () => {
    // "I fixed the config" and "the corrected check was executed" are two
    // facts. The settings change moves the epoch, so the previous run does not
    // count for the new condition.
    instance.writeRelay({ ...FIXED_RELAY, healthCheckProbes: ["archive", "config"] });
    const before = await instance.state();
    expect(before.health.honest).toBe(true);
    expect(before.health.checkedThisEpoch).toBe(false);
    expect((await instance.posture()).gates.health_honest).toBe(false);

    await instance.get("/relay/healthz");
    expect((await instance.state()).health.checkedThisEpoch).toBe(true);
    expect((await instance.posture()).gates.health_honest).toBe(true);
  });

  it("should not let reading /posture stand in for running the check", async () => {
    // The gate evaluates the predicate in three counterfactual worlds. If that
    // evaluation went through the route, polling /posture would raise the gate
    // on the participant's behalf and flood the log with probe lines.
    instance.writeRelay({ ...FIXED_RELAY, healthCheckProbes: ["config", "archive"] });
    for (let poll = 0; poll < 5; poll += 1) await instance.posture();
    expect((await instance.state()).health.checkedThisEpoch).toBe(false);
    expect((await instance.posture()).gates.health_honest).toBe(false);
  });

  it("should refuse the receipt earned honestly once the condition is loosened again", async () => {
    // The anti-coincidence test for this checkpoint: harvest the real receipt
    // from a state that earned it, then submit that real receipt from a state
    // that must not accept it. A regression that stamped the receipt onto the
    // failure path would pass every other test in this file.
    instance.writeRelay(FIXED_RELAY);
    await instance.get("/relay/healthz");
    const token = (await instance.posture()).tokens.health_honest as string;
    expect(token).toMatch(/^TC\{health_honest_[0-9a-f]{16}\}$/);
    expect(await instance.correct("honest-health", token)).toBe(true);

    for (const probes of [["config"], ["archive"], []]) {
      instance.writeRelay({ ...FIXED_RELAY, healthCheckProbes: probes });
      await instance.get("/relay/healthz");
      expect((await instance.posture()).tokens.health_honest).toBeNull();
      expect(await instance.correct("honest-health", token)).toBe(false);
    }

    instance.writeRelay(FIXED_RELAY);
    await instance.get("/relay/healthz");
    expect(await instance.correct("honest-health", token)).toBe(true);
  });

  it("should refuse a receipt minted by another container on the same seed", async () => {
    // Receipts come from a per-boot secret, not from FLAG_SEED, so one cannot
    // be carried between runs — including by code running inside the app, which
    // can read FLAG_SEED back out of /proc/self/environ.
    instance.writeRelay(FIXED_RELAY);
    await instance.get("/relay/healthz");
    const mine = (await instance.posture()).tokens.health_honest as string;

    main.writeRelay(FIXED_RELAY);
    await main.get("/relay/healthz");
    await main.generateSignal();
    const theirs = (await main.posture()).tokens.health_honest as string;

    expect(theirs).not.toBe(mine);
    expect(await instance.correct("honest-health", theirs)).toBe(false);
    expect(await main.correct("honest-health", mine)).toBe(false);
    main.writeRelay(SHIPPED_RELAY);
  });
});

// ---------------------------------------------------------------------------
// the solve, and every way of un-solving it
// ---------------------------------------------------------------------------

describe("stackstack-observability solved, and un-solved again", () => {
  const port = 18344;
  const verifyPort = 18345;
  let instance: Instance;
  let incidentId = "";
  let safeToken = "";
  let downCode = "";
  let healthyCodes: string[] = [];

  beforeAll(async () => {
    instance = await new Instance(scratch, "solve", port, verifyPort).start();
  });

  afterAll(() => instance.stop());

  it("should hand over nothing until the settings say to write it down", async () => {
    await instance.generateSignal();
    expect(await instance.relayLines()).toEqual([]);
    const state = await instance.state();
    expect(state.signal).toEqual({ archivedLinesThisEpoch: 0, dropLinesThisEpoch: 0 });
  });

  it("should start writing the dropped writes down when the setting is turned on", async () => {
    instance.writeRelay({ ...SHIPPED_RELAY, archiveLogging: "on" });
    await instance.generateSignal();
    const lines = await instance.relayLines();
    expect(lines.some((line) => line.startsWith("relay drop "))).toBe(true);
    expect(lines.some((line) => line.startsWith("relay archived "))).toBe(true);
    incidentId = fieldFrom(lines, "relay drop ", "incident");
    expect(incidentId).toMatch(/^INC-[0-9a-f]{10}$/);
  });

  it("should keep the incident id off every surface except the log", async () => {
    // The reward for reading the log has to be something the log alone gives.
    expect(await instance.metrics()).not.toContain(incidentId);
    expect(JSON.stringify(await instance.state())).not.toContain(incidentId);
    expect(JSON.stringify(await instance.posture())).not.toContain(incidentId);
    expect((await instance.get("/archive")).text).not.toContain(incidentId);
    expect((await instance.get("/")).text).not.toContain(incidentId);
  });

  it("should credit the incident id, and only the incident id", async () => {
    expect(await instance.correct("silent-failures", incidentId)).toBe(true);
    expect(await instance.correct("silent-failures", ` ${incidentId} `)).toBe(true);
    const wholeLine = (await instance.relayLines()).find((line) =>
      line.startsWith("relay drop "),
    ) as string;
    expect(await instance.correct("silent-failures", wholeLine)).toBe(false);
    expect(await instance.correct("silent-failures", "INC-0000000000")).toBe(false);
  });

  it("should be leaking the relay's downstream value while the detail is full", async () => {
    // The premise of `leak-shut`, proven rather than assumed: the log really
    // does carry it before the fix.
    const state = await instance.state();
    expect(state.credentialVisibleIn).toContain("log");
    const lines = await instance.relayLines();
    const auth = fieldFrom(lines, "relay drop ", "auth");
    expect(auth).toMatch(/^rk_live_[0-9a-f]{32}$/);
    expect((await instance.get("/api/logs?limit=400")).text).toContain(auth);
  });

  it("should keep the relay's downstream value off every surface except the log", async () => {
    // The absence check grades the log because the log is the only place this
    // value is written. That is an invariant of the app, so it is pinned here
    // directly rather than left implicit in the grading function — measured in
    // the state where the value definitely exists somewhere.
    const auth = fieldFrom(await instance.relayLines(), "relay drop ", "auth");
    expect(auth.startsWith("rk_live_")).toBe(true);
    expect(await instance.metrics()).not.toContain("rk_live_");
    expect(JSON.stringify(await instance.state())).not.toContain("rk_live_");
    expect(JSON.stringify(await instance.posture())).not.toContain("rk_live_");
    expect((await instance.get("/archive")).text).not.toContain("rk_live_");
    expect((await instance.get("/relay")).text).not.toContain("rk_live_");
    expect((await instance.get("/relay/healthz")).text).not.toContain("rk_live_");
    expect((await instance.get("/")).text).not.toContain("rk_live_");
  });

  it("should refuse the handover checkpoint while the value is in the current lines", async () => {
    expect(await instance.correct("leak-shut", "anything")).toBe(false);
    expect((await instance.posture()).gates.credential_out_of_logs).toBe(false);
  });

  it("should redact the value and keep the investigation fields when the detail is turned down", async () => {
    instance.writeRelay({ ...SHIPPED_RELAY, archiveLogging: "on", logDetail: "safe" });
    await instance.generateSignal();
    const state = await instance.state();
    expect(state.credentialVisibleIn).toEqual([]);
    const lines = await instance.relayLines();
    const drop = lines.filter((line) => line.startsWith("relay drop ")).at(-1) as string;
    const archived = lines.filter((line) => line.startsWith("relay archived ")).at(-1) as string;
    for (const field of ["shard=", "code=", "target=", "epoch="]) {
      expect(drop).toContain(field);
      expect(archived).toContain(field);
    }
    expect(drop).toContain("reason=shard_unreachable");
    expect(drop).toContain(`incident=${incidentId}`);
    expect(drop).toContain("auth=<redacted>");
    safeToken = fieldFrom(lines, "relay drop ", "safe-token");
    expect(safeToken).toMatch(/^[0-9a-f]{12}$/);
  });

  it("should re-issue the safe-log value on every line, not once", async () => {
    // A one-shot answer in a bounded ring is a trap: a participant who looked
    // away for a minute would need a restart, and a restart is expensive here.
    const before = await instance.currentEpochRelayLines();
    expect(before.length).toBeGreaterThan(1);
    for (let more = 0; more < 6; more += 1) {
      await instance.post({ author: "you", title: `reissue-${more}`, body: "x" });
    }
    await instance.metrics();
    const after = await instance.currentEpochRelayLines();
    expect(after.length).toBe(before.length + 6);
    // Every line under these settings carries it, and it is the same value.
    for (const line of after) expect(line).toContain(`safe-token=${safeToken}`);
  });

  it("should credit the handover once the current lines are clean", async () => {
    expect(await instance.correct("leak-shut", safeToken)).toBe(true);
    expect((await instance.posture()).gates.credential_out_of_logs).toBe(true);
  });

  it("should leave the lines that already leaked exactly as they were", async () => {
    // Deliberate, and the writeup says so: a settings change does not un-write
    // history. This is why the real remediation is rotating the value.
    const text = (await instance.get("/api/logs?limit=400")).text;
    expect(text).toMatch(/auth=rk_live_[0-9a-f]{32}/);
    expect(text).toContain("auth=<redacted>");
  });

  it("should refuse a mask that only blanks the tail of the value", async () => {
    // The wrong fix people actually ship. The line looks redacted, the fields
    // survive, and enough of the value is left to be worth rotating over — so
    // the absence check matches a prefix rather than the whole string. Note
    // there is no safe-log value on these lines at all: a mask is not a
    // redaction and does not earn the receipt for one.
    instance.writeRelay({ ...SHIPPED_RELAY, archiveLogging: "on", logDetail: "masked" });
    await instance.generateSignal();
    const lines = await instance.currentEpochRelayLines();
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line).not.toContain("safe-token=");
    expect(lines.some((line) => line.includes("shard="))).toBe(true);
    expect((await instance.state()).credentialVisibleIn).toContain("log");
    expect(safeToken).not.toBe("");
    expect(await instance.correct("leak-shut", safeToken)).toBe(false);
  });

  it("should refuse a line cut down until nothing sensitive is left", async () => {
    // The other wrong fix: "I redacted the log" by deleting the fields. The
    // credential really is gone — the absence check would pass — but the line
    // no longer says which shard, which code, or why, so the investigation went
    // with it. Precondition B refuses it before the absence is ever looked at.
    instance.writeRelay({ ...SHIPPED_RELAY, archiveLogging: "on", logDetail: "minimal" });
    await instance.generateSignal();
    const lines = await instance.currentEpochRelayLines();
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line).not.toContain("rk_live_");
      expect(line).not.toContain("shard=");
      expect(line).not.toContain("incident=");
    }
    expect((await instance.state()).credentialVisibleIn).toEqual([]);
    expect(safeToken).not.toBe("");
    expect(await instance.correct("leak-shut", safeToken)).toBe(false);
    // The signal itself is also gone: no incident id anywhere to submit.
    expect(await instance.correct("silent-failures", incidentId)).toBe(false);
  });

  it("should name the down shard's code, and refuse a healthy shard's", async () => {
    // The anti-coincidence test for `root-cause`: every code here is a real
    // value harvested from the running app, and three of the four must be
    // refused. A handler that accepted "any code /metrics prints" would pass a
    // test that only submitted garbage.
    const metrics = await instance.metrics();
    const series = shardSeries(metrics);
    expect(series.length).toBe(4);
    downCode = series.find((entry) => entry.up === 0)?.code as string;
    healthyCodes = series.filter((entry) => entry.up === 1).map((entry) => entry.code);
    expect(healthyCodes.length).toBe(3);
    expect(await instance.correct("root-cause", downCode)).toBe(true);
    for (const code of healthyCodes) {
      expect(await instance.correct("root-cause", code)).toBe(false);
    }
  });

  it("should turn every gate green once all four are done", async () => {
    instance.writeRelay(FIXED_RELAY);
    await instance.generateSignal();
    await instance.get("/relay/healthz");
    const posture = await instance.posture();
    expect(posture.gates).toEqual({
      traffic_seen: true,
      failures_logged: true,
      health_honest: true,
      credential_out_of_logs: true,
    });
  });

  it("should refuse the real incident id again the moment the log is turned back off", async () => {
    // The anti-coincidence test for `silent-failures`. The value is genuine and
    // was earned; the state is not.
    instance.writeRelay({ ...FIXED_RELAY, archiveLogging: "off" });
    await instance.generateSignal();
    expect(await instance.correct("silent-failures", incidentId)).toBe(false);
    expect(await instance.correct("leak-shut", safeToken)).toBe(false);
    expect((await instance.posture()).gates.failures_logged).toBe(false);
    expect((await instance.posture()).gates.credential_out_of_logs).toBe(false);
  });

  it("should refuse the real safe-log value again the moment the detail goes back to full", async () => {
    // The anti-coincidence test for `leak-shut`. Turning the detail back up for
    // "one more look" re-leaks, and the score follows the app, not the memory
    // of a state that was once true.
    instance.writeRelay({ ...FIXED_RELAY, logDetail: "full" });
    await instance.generateSignal();
    expect((await instance.state()).credentialVisibleIn).toContain("log");
    expect(await instance.correct("leak-shut", safeToken)).toBe(false);
    // ...and the incident id is fine again, because that checkpoint is about
    // the signal existing, not about what is in it.
    expect(await instance.correct("silent-failures", incidentId)).toBe(true);
  });

  it("should credit the handover again once the detail is turned back down", async () => {
    // ...so the two refusals above are the state changing, not the checkpoint
    // having been permanently spent.
    instance.writeRelay(FIXED_RELAY);
    await instance.generateSignal();
    expect(await instance.correct("leak-shut", safeToken)).toBe(true);
    expect(await instance.correct("silent-failures", incidentId)).toBe(true);
  });

  it("should refuse a submission that is empty, partial or one character over", async () => {
    // Guards against an equality loosened to a substring or a truthiness test.
    await instance.get("/relay/healthz");
    const answers: Record<string, string> = {
      "silent-failures": incidentId,
      "honest-health": (await instance.posture()).tokens.health_honest as string,
      "leak-shut": safeToken,
      "root-cause": downCode,
    };
    for (const check of metadata.scoring.checks) {
      const right = answers[check.id] as string;
      expect(await instance.correct(check.id, "")).toBe(false);
      expect(await instance.correct(check.id, " ")).toBe(false);
      expect(await instance.correct(check.id, right.slice(0, -1))).toBe(false);
      expect(await instance.correct(check.id, `${right}x`)).toBe(false);
      // ...and the real answer still passes, so the four assertions above are
      // not passing merely because the checkpoint refuses everything.
      expect(await instance.correct(check.id, right)).toBe(true);
    }
  });

  it("should keep the answers from this instance for the vacuous-pass suite", () => {
    expect(incidentId).not.toBe("");
    expect(safeToken).not.toBe("");
    expect(downCode).not.toBe("");
    solvedAnswers = { incidentId, safeToken, downCode, healthyCodes };
  });
});

/** Genuine answers harvested from the solved instance, for the suites below. */
let solvedAnswers: {
  incidentId: string;
  safeToken: string;
  downCode: string;
  healthyCodes: string[];
} = { incidentId: "", safeToken: "", downCode: "", healthyCodes: [] };

// ---------------------------------------------------------------------------
// a container nobody has touched
// ---------------------------------------------------------------------------

describe("stackstack-observability on an untouched container", () => {
  const port = 18346;
  const verifyPort = 18347;
  let instance: Instance;

  beforeAll(async () => {
    // Same seed as the solved instance above, so the seed-derived answers are
    // byte-identical — which is the entire point of this suite.
    instance = await new Instance(scratch, "fresh", port, verifyPort).start();
  });

  afterAll(() => instance.stop());

  it("should refuse all four genuine answers on a container that has measured nothing", async () => {
    expect(solvedAnswers.incidentId).not.toBe("");
    expect(await instance.correct("silent-failures", solvedAnswers.incidentId)).toBe(false);
    expect(await instance.correct("leak-shut", solvedAnswers.safeToken)).toBe(false);
    expect(await instance.correct("root-cause", solvedAnswers.downCode)).toBe(false);
    expect(await instance.correct("honest-health", "TC{health_honest_0000000000000000}")).toBe(false);
    expect((await instance.posture()).tokens.health_honest).toBeNull();
  });

  it("should still refuse them with the settings file already fixed, before any traffic", async () => {
    // The restart penalty, stated as a test: a container brought up with the
    // correct settings has still measured nothing, and measuring nothing is not
    // a pass. This is why restarting to "clear the error" costs.
    instance.writeRelay(FIXED_RELAY);
    await instance.get("/relay/healthz");
    expect(await instance.correct("silent-failures", solvedAnswers.incidentId)).toBe(false);
    expect(await instance.correct("leak-shut", solvedAnswers.safeToken)).toBe(false);
    expect(await instance.correct("root-cause", solvedAnswers.downCode)).toBe(false);
    const posture = await instance.posture();
    expect(posture.gates.traffic_seen).toBe(false);
    expect(posture.gates.failures_logged).toBe(false);
    expect(posture.gates.credential_out_of_logs).toBe(false);
    // ...while the health condition, which is not about traffic, is honest.
    expect(posture.gates.health_honest).toBe(true);
  });

  it("should refuse everything while the board is closed, however correct the settings", async () => {
    // "Stop the errors" as a strategy: no writes, no failures, no signal, no
    // marks. Silence is not recovery.
    instance.writeConfig({ acceptingPosts: false });
    const rejected = await instance.post({ author: "you", title: "blocked", body: "" });
    expect(rejected.status).toBe(409);
    for (const check of ["silent-failures", "leak-shut", "root-cause"]) {
      expect(await instance.correct(check, solvedAnswers.incidentId)).toBe(false);
    }
    expect((await instance.posture()).gates.traffic_seen).toBe(false);
    instance.writeConfig({ acceptingPosts: true });
  });

  it("should reproduce the same seed-derived answers once traffic finally flows", async () => {
    // The other half of the restart lesson: the failure is identical after a
    // restart (the map is derived, not random), only the evidence is gone. So a
    // restart cannot fix it and can only cost.
    await instance.generateSignal();
    await instance.get("/relay/healthz");
    const lines = await instance.relayLines();
    expect(fieldFrom(lines, "relay drop ", "incident")).toBe(solvedAnswers.incidentId);
    expect(fieldFrom(lines, "relay drop ", "safe-token")).toBe(solvedAnswers.safeToken);
    const series = shardSeries(await instance.metrics());
    expect(series.find((entry) => entry.up === 0)?.code).toBe(solvedAnswers.downCode);
    for (const check of metadata.scoring.checks) {
      const answers: Record<string, string> = {
        "silent-failures": solvedAnswers.incidentId,
        "honest-health": (await instance.posture()).tokens.health_honest as string,
        "leak-shut": solvedAnswers.safeToken,
        "root-cause": solvedAnswers.downCode,
      };
      expect(await instance.correct(check.id, answers[check.id] as string)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// a second seed
// ---------------------------------------------------------------------------

describe("stackstack-observability under a different seed", () => {
  const port = 18348;
  const verifyPort = 18349;
  let instance: Instance;

  beforeAll(async () => {
    instance = await new Instance(scratch, "seeded", port, verifyPort).start({
      seed: OTHER_SEED,
      relay: FIXED_RELAY,
    });
    await instance.generateSignal();
    await instance.get("/relay/healthz");
  });

  afterAll(() => instance.stop());

  it("should derive a different answer for every checkpoint", async () => {
    // An answer table written against one deploy has to be worthless against
    // the next, or the whole problem is a lookup.
    const lines = await instance.relayLines();
    expect(fieldFrom(lines, "relay drop ", "incident")).not.toBe(solvedAnswers.incidentId);
    expect(fieldFrom(lines, "relay drop ", "safe-token")).not.toBe(solvedAnswers.safeToken);
    const codes = shardSeries(await instance.metrics()).map((entry) => entry.code);
    expect(codes).not.toContain(solvedAnswers.downCode);
    for (const code of solvedAnswers.healthyCodes) expect(codes).not.toContain(code);
  });

  it("should refuse the other seed's answers outright", async () => {
    expect(await instance.correct("silent-failures", solvedAnswers.incidentId)).toBe(false);
    expect(await instance.correct("leak-shut", solvedAnswers.safeToken)).toBe(false);
    expect(await instance.correct("root-cause", solvedAnswers.downCode)).toBe(false);
  });

  it("should not even share a shard name with the other seed", async () => {
    // Not just the answers: the archive's own layout moves, so "post this
    // title, it lands on this shard, it fails" is not transferable advice.
    const mine = shardSeries(await instance.metrics()).map((entry) => entry.shard);
    const theirs = shardSeries(await main.metrics()).map((entry) => entry.shard);
    expect(mine.some((shard) => theirs.includes(shard))).toBe(false);
  });

  it("should partition titles across its shards differently, not just rename them", async () => {
    // The map itself has to move with the seed, not only the shard names. If
    // titles were grouped identically under every seed, an answer table for one
    // deploy would still tell you which *group* to avoid on the next.
    const titles = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => `partition-${index}`);
    const mine: string[] = [];
    const theirs: string[] = [];
    for (const title of titles) mine.push(await routeOf(instance, title));
    for (const title of titles) theirs.push(await routeOf(main, title));
    // Compared as a partition rather than as names, since the names differ by
    // construction and would make this pass without saying anything.
    const signature = (routes: string[]) => routes.map((shard) => routes.indexOf(shard)).join(",");
    expect(new Set(mine).size).toBeGreaterThan(1);
    expect(signature(mine)).not.toBe(signature(theirs));
  });

  it("should still accept its own answers", async () => {
    // ...so the assertions above are not passing because this instance refuses
    // everything.
    const lines = await instance.relayLines();
    expect(await instance.correct("silent-failures", fieldFrom(lines, "relay drop ", "incident"))).toBe(true);
    expect(await instance.correct("leak-shut", fieldFrom(lines, "relay drop ", "safe-token"))).toBe(true);
    const down = shardSeries(await instance.metrics()).find((entry) => entry.up === 0);
    expect(await instance.correct("root-cause", down?.code as string)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// a container where only the down shard has been written to
// ---------------------------------------------------------------------------

describe("stackstack-observability with nothing but failures", () => {
  /**
   * "Name the slice that is actually down" is a diagnosis, and a diagnosis needs
   * a contrast. A container where every write has failed does not say *this one
   * slice* is broken — it says something upstream of all four is. So the
   * checkpoint requires a success somewhere else, and this is the only state
   * that can tell whether that requirement is doing any work.
   *
   * The ports are the health suite's, reused after it has shut down: this file
   * owns 18340-18349 and needed a seventh instance.
   */
  const port = 18342;
  const verifyPort = 18343;
  let instance: Instance;
  let failingTitle = "";
  let downCode = "";

  beforeAll(async () => {
    // Find a title that lands on the down shard, using the instance that
    // already has traffic on it. The map is seed-derived, so a title that fails
    // on one container fails on every container with the same seed.
    let before = (await main.state()).archive.dropped;
    for (let attempt = 0; attempt < 60 && failingTitle === ""; attempt += 1) {
      const title = `failing-probe-${attempt}`;
      await main.post({ author: "you", title, body: "x" });
      const after = (await main.state()).archive.dropped;
      if (after > before) failingTitle = title;
      before = after;
    }
    if (failingTitle === "") throw new Error("no title landing on the down shard was found");
    downCode = shardSeries(await main.metrics()).find((entry) => entry.up === 0)?.code as string;

    instance = await new Instance(scratch, "onlyfail", port, verifyPort).start({
      relay: FIXED_RELAY,
    });
  });

  afterAll(() => instance.stop());

  it("should refuse the down shard's own code while nothing has ever succeeded", async () => {
    for (let repeat = 0; repeat < 5; repeat += 1) {
      expect((await instance.post({ author: "you", title: failingTitle, body: "x" })).status).toBe(201);
    }
    const metrics = await instance.metrics();
    expect(metricTotals(metrics)).toEqual({ archived: 0, dropped: 5 });
    expect(shardSeries(metrics).length).toBe(1);
    // The value is genuine, the shard really is the one that is down, and it is
    // still refused: one slice failing and every slice failing are different
    // findings.
    expect(await instance.correct("root-cause", downCode)).toBe(false);
    expect((await instance.posture()).gates.traffic_seen).toBe(false);
  });

  it("should refuse the incident id too while nothing has ever succeeded", async () => {
    // "Everything is failing" is not the finding this problem is about, and it
    // is what an operator sees after switching the downstream off entirely. The
    // signal is only complete when both outcomes are really happening.
    expect(metricTotals(await instance.metrics())).toEqual({ archived: 0, dropped: 5 });
    expect((await instance.currentEpochRelayLines()).some((line) => line.startsWith("relay drop "))).toBe(true);
    expect(await instance.correct("silent-failures", solvedAnswers.incidentId)).toBe(false);
    expect(await instance.correct("leak-shut", solvedAnswers.safeToken)).toBe(false);
  });

  it("should accept it as soon as another slice has really taken a write", async () => {
    await instance.generateSignal();
    expect(metricTotals(await instance.metrics()).archived).toBeGreaterThan(0);
    expect(await instance.correct("root-cause", downCode)).toBe(true);
    // ...and so are the two above, so the refusals were the missing contrast
    // rather than the checkpoints refusing everything on this container.
    expect(await instance.correct("silent-failures", solvedAnswers.incidentId)).toBe(true);
    expect(await instance.correct("leak-shut", solvedAnswers.safeToken)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the scoring surface itself
// ---------------------------------------------------------------------------

describe("stackstack-observability /verify", () => {
  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await main.answer(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    // The other direction too: a handler with no checkpoint behind it is dead
    // code nothing can reach, and a sign the two drifted apart.
    const source = readFileSync(SCENARIO_FILE, "utf8");
    const block = source.slice(source.indexOf("export const checks = {"));
    const handlers = [...block.matchAll(/^ {2}"([a-z][a-z0-9-]*)":/gm)].map((m) => m[1] as string);
    expect(handlers.sort()).toEqual(metadata.scoring.checks.map((check) => check.id).sort());
  });

  it("should fail closed on a checkpoint id it does not know", async () => {
    const response = await main.answer("no-such-checkpoint", "anything");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_checkpoint");
  });

  it("should fail closed on an inherited property name, not call it", async () => {
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await main.answer(inherited, "anything");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_checkpoint");
    }
  });

  it("should not change the app while scoring it", async () => {
    // Being scored must never cost a participant their evidence. Every handler
    // is a read, so a wrong answer, a retry and a burst all leave the same
    // counters, the same posts and the same settings behind.
    main.writeRelay(FIXED_RELAY);
    await main.generateSignal();
    const before = await main.state();
    const posts = (await main.get("/api/board")).body.posts.length;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      for (const check of metadata.scoring.checks) await main.correct(check.id, "wrong");
    }
    const after = await main.state();
    expect(after.archive).toEqual(before.archive);
    expect(after.settings).toEqual(before.settings);
    expect(after.epoch).toBe(before.epoch);
    expect((await main.get("/api/board")).body.posts.length).toBe(posts);
    main.writeRelay(SHIPPED_RELAY);
  });
});

// ---------------------------------------------------------------------------
// process robustness
// ---------------------------------------------------------------------------

describe("stackstack-observability process robustness", () => {
  it("should survive a request target it cannot even parse", async () => {
    // Both servers share one process: an unhandled throw here would take the
    // board and /verify down together, over a typo.
    await new Promise<void>((resolve) => {
      const socket = connect(CHALLENGE_PORT, "127.0.0.1", () => {
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
    expect((await fetch(`http://127.0.0.1:${VERIFY_PORT}/healthz`)).ok).toBe(true);
  });

  it("should escape what a participant writes before putting it on the page", async () => {
    const payload = '<script>alert("xss")</script>';
    const created = await main.post({
      author: `a${payload}`,
      title: `t${payload}`,
      body: `b${payload}`,
    });
    expect(created.status).toBe(201);
    const page = await main.get("/");
    expect(page.text).not.toContain("<script>");
    expect(page.text).toContain("&lt;script&gt;");
  });

  it("should escape a settings error before rendering it on the relay console", async () => {
    // The console renders the relay's own settings error, and the text of that
    // error contains a key name the participant wrote. The same rule as the
    // board applies to a surface this problem added.
    main.writeRelay({ ...SHIPPED_RELAY, '<img src=x onerror="1">': true });
    const page = await main.get("/relay");
    expect(page.status).toBe(200);
    expect(page.text).not.toContain("<img src=x");
    expect(page.text).toContain("&lt;img src=x");
    main.writeRelay(SHIPPED_RELAY);
    expect((await main.get("/relay/healthz")).status).toBe(200);
  });

  it("should 404 a relay path it does not serve", async () => {
    const missing = await main.get("/relay/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("not_found");
  });

  it("should keep the boot line reachable however much traffic arrived", async () => {
    const lines = await main.logs();
    expect(lines.some((line) => line.message.startsWith("boot ok boot-check="))).toBe(true);
  });

  it("should serve /metrics as Prometheus text, not JSON", async () => {
    const response = await fetch(`${BOARD}/metrics`);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-type")).toContain("version=0.0.4");
  });
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

describe("stackstack-observability wiring", () => {
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

  it("should publish the challenge endpoints' port, on loopback only", () => {
    for (const url of Object.values(metadata.runtime.challengeEndpoints)) {
      expect(service.ports).toContain(`127.0.0.1:${new URL(url).port}:8080`);
    }
    for (const published of service.ports) expect(published.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should publish the verify port on loopback only", () => {
    expect(service.ports).toContain(`127.0.0.1:${new URL(metadata.runtime.verifyUrl).port}:8081`);
  });

  it("should declare exactly the ports it publishes", () => {
    const published = service.ports.map((entry) => Number(entry.split(":")[1])).sort((a, b) => a - b);
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    expect(existsSync(join(composeDir, service.build.context, service.build.dockerfile))).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("observability");
    expect(existsSync(join(composeDir, service.build.context, "app", "scenarios", "observability.mjs"))).toBe(true);
  });

  it("should pass the per-deploy seed through rather than pinning one", () => {
    // Every answer in this problem is derived from it, so a compose file that
    // hard-coded a value would make the whole catalog share one answer.
    expect(service.environment.FLAG_SEED).toBe("${FLAG_SEED:-local-dev-seed}");
  });

  it("should mount both participant-owned files read-only, where the app reads them", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro", "./relay:/app/relay:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "relay", "relay.json"))).toBe(true);
  });

  it("should name both paths as the participant sees them, from the platform checkout", () => {
    for (const [variable, inThisRepo] of [
      ["CONFIG_HINT", "challenges/stackstack-observability/local/config/app.json"],
      ["RELAY_HINT", "challenges/stackstack-observability/local/relay/relay.json"],
    ] as const) {
      expect(service.environment[variable]).toBe(`problems/${inThisRepo}`);
      expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
    }
  });

  it("should give the participant-facing docs the same paths the app prints", () => {
    const hint = service.environment.RELAY_HINT as string;
    for (const name of ["README.md", "README.ja.md", "metadata.json"]) {
      expect(readFileSync(join(PROBLEM_DIR, name), "utf8")).toContain(hint);
    }
  });

  it("should point the container healthcheck at the board, not at the relay", () => {
    // The relay's health check answers 503 once it is correct. A compose
    // healthcheck pointed at it would mark a solved container unhealthy.
    const raw = readFileSync(join(composeDir, "docker-compose.yml"), "utf8");
    expect(raw).toContain("127.0.0.1:8080/healthz");
    expect(raw).not.toContain("relay/healthz");
  });

  it("should show the relay settings path on the console the participant opens", async () => {
    const page = await main.get("/relay");
    expect(page.text).toContain(RELAY_HINT);
    expect(page.text).not.toContain("/app/relay/relay.json");
  });
});
