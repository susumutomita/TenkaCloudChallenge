import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-secrets grades a credential lifecycle, and a credential lifecycle
 * is only worth anything if the credential really stops working. So these tests
 * drive the real app over real HTTP under Bun — present the leaked key, issue,
 * cut over, revoke, narrow, submit — rather than asserting on the scenario's
 * source text.
 *
 * The one participant-owned file this problem is about (`local/ops/ops.json`)
 * is copied into a scratch directory first. The suite edits it the way a
 * participant does, and must not leave the repository's shipped one rewritten.
 *
 * Two instances run on the same `FLAG_SEED` throughout. That is the point of
 * them: every submission in this problem is seed-derived, so the *true* answer
 * can be harvested from a solved instance and offered to an untouched one. A
 * checkpoint that credits the right string without the work behind it is caught
 * there and nowhere else — guessing failing only ever proves that guessing
 * fails.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-secrets");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "secrets.mjs");
const ONBOARDING_DIR = join(REPO_ROOT, "challenges", "stackstack-onboarding");

const SEED = "stackstack-secrets-test-seed";
const OPS_HINT = "problems/challenges/stackstack-secrets/local/ops/ops.json";
const CONFIG_HINT = "problems/challenges/stackstack-secrets/local/config/app.json";

const LEGACY_KEY_ID = "ops-legacy";
/** The actions the shipped starter's wildcard covers, and the job's own two. */
const DIGEST_ACTIONS = ["board:count", "digest:publish"];

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
  scratch = mkdtempSync(join(tmpdir(), "stackstack-secrets-"));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

interface Instance {
  readonly board: string;
  readonly verify: string;
  readonly manifestPath: string;
  readonly configPath: string;
  kill(): void;
  stdout(): string;
  stderr(): string;
}

/**
 * Start one real app on its own ports, with its own copy of the manifest.
 *
 * stderr is captured because the break-glass credential is written there and
 * nowhere else — which is the property the suite has to be able to check.
 */
async function startInstance(
  name: string,
  challengePort: number,
  verifyPort: number,
  options: { scenario?: string; seed?: string; sourceDir?: string } = {},
) {
  const scenario = options.scenario ?? "secrets";
  const sourceDir = options.sourceDir ?? PROBLEM_DIR;
  const manifestPath = join(scratch, `${name}-ops.json`);
  const configPath = join(scratch, `${name}-app.json`);
  if (existsSync(join(sourceDir, "local", "ops", "ops.json"))) {
    writeFileSync(manifestPath, readFileSync(join(sourceDir, "local", "ops", "ops.json")));
  }
  writeFileSync(configPath, readFileSync(join(sourceDir, "local", "config", "app.json")));

  let stdout = "";
  let stderr = "";
  const child = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: scenario,
      FLAG_SEED: options.seed ?? SEED,
      APP_CONFIG: configPath,
      CONFIG_HINT,
      OPS_MANIFEST: manifestPath,
      OPS_HINT,
      CHALLENGE_PORT: String(challengePort),
      VERIFY_PORT: String(verifyPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const board = `http://127.0.0.1:${challengePort}`;
  const deadline = Date.now() + 8_000;
  for (;;) {
    try {
      if ((await fetch(`${board}/healthz`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`the ${name} instance never became healthy`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // The first nightly run is deferred one macrotask past the board seeding, so
  // give it a turn before anything asserts on the starter's posture.
  await new Promise((resolve) => setTimeout(resolve, 60));

  const instance: Instance = {
    board,
    verify: `http://127.0.0.1:${verifyPort}/verify`,
    manifestPath,
    configPath,
    kill: () => child.kill(),
    stdout: () => stdout,
    stderr: () => stderr,
  };
  return instance;
}

interface Posture {
  gates: Record<string, boolean>;
  tokens: Record<string, string | null>;
  ready: boolean;
  readyToken: string | null;
}

interface KeyRow {
  keyId: string;
  fingerprint: string;
  status: string;
  revocationReceipt: string | null;
}

/** The whole HTTP vocabulary these tests need, bound to one instance. */
function client(instance: () => Instance) {
  const json = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${instance().board}${path}`, init);
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body, text };
  };
  const api = {
    get: (path: string) => json(path),
    post: (path: string, headers: Record<string, string> = {}) =>
      json(path, { method: "POST", headers }),
    posture: async () => (await json("/posture")).body as Posture,
    keys: async () => ((await json("/api/ops/keys")).body as { keys: KeyRow[] }).keys,
    key: async (keyId: string) => (await api.keys()).find((entry) => entry.keyId === keyId),
    policy: async () =>
      (await json("/api/ops/policy")).body as {
        identity: string | null;
        grants: string[];
        catalog: Array<{ action: string; effect: string }>;
        allowed: string[];
        denied: string[];
        digest: string;
      },
    state: async () => (await json("/api/ops/state")).body,
    journal: async () =>
      ((await json("/api/ops/journal?limit=300")).body as {
        entries: Array<{ action: string; keyId: string; outcome: string; source: string }>;
      }).entries,
    whoami: (secret: string) => json("/api/ops/whoami", { headers: { "x-ops-key": secret } }),
    act: (action: string, secret: string) =>
      json(`/api/ops/act?action=${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { "x-ops-key": secret },
      }),
    runDigest: () => json("/api/ops/digest/run", { method: "POST" }),
    mint: (breakGlass: string) =>
      json("/api/ops/keys", { method: "POST", headers: { "x-break-glass": breakGlass } }),
    revoke: (keyId: string, breakGlass: string) =>
      json(`/api/ops/keys/revoke?keyId=${encodeURIComponent(keyId)}`, {
        method: "POST",
        headers: { "x-break-glass": breakGlass },
      }),
    /** Rewrite the manifest the way an editor save does. */
    writeManifest(next: { identity?: string; grants?: string[] }) {
      const current = JSON.parse(readFileSync(instance().manifestPath, "utf8")) as Record<string, unknown>;
      writeFileSync(instance().manifestPath, JSON.stringify({ ...current, ...next }, null, 2));
    },
    writeManifestRaw(text: string) {
      writeFileSync(instance().manifestPath, text);
    },
    async answer(checkpointId: string, submission: string) {
      const response = await fetch(instance().verify, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpointId, submission, context: { teamId: "t", problemId: "p" } }),
      });
      return { status: response.status, body: (await response.json()) as any };
    },
    async correct(checkpointId: string, submission: string) {
      return (await api.answer(checkpointId, submission)).body.correct as boolean;
    },
    /** The credential the predecessor left on the board, read off the board. */
    async leakedSecret() {
      const board = await json("/api/board");
      const found = /SSOPS-[0-9a-f]{20}/.exec(board.text);
      expect(found).not.toBeNull();
      return (found as RegExpExecArray)[0];
    },
  };
  return api;
}

/** The break-glass credential, from the startup output — its only home. */
function breakGlassFrom(instance: Instance) {
  const found = /break-glass credential: ([0-9a-f]{16})/.exec(instance.stderr());
  expect(found).not.toBeNull();
  return (found as RegExpExecArray)[1] as string;
}

// ---------------------------------------------------------------------------

describe("stackstack-secrets scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
    expect(metadata.scoring.kind).toBe("multi-verify");
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(200);
  });

  it("should spend the Medium tier's whole wrong-answer budget and no more", () => {
    // The validator only enforces the tier value for a flat `points`, so spread
    // across checkpoints it still has to add up to 5% of the base.
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
    expect(spent).toBe(94);
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
      for (const hint of english?.hints ?? []) expect(hint.content.length).toBeGreaterThan(20);
    }
  });

  it("should not name a vulnerability class in anything the competitor is shown", () => {
    // AGENT.md §10: player-visible strings name the symptom or the asset. The
    // labels and hints are on the problem page; `description` is not.
    const visible = JSON.stringify([
      ...metadata.scoring.checks.map((check) => ({ label: check.label, hints: check.hints })),
      ...metadata.i18n.en.checks,
    ]).toLowerCase();
    for (const forbidden of [
      "privilege escalation",
      "権限昇格",
      "hardcoded credential",
      "over-permissive",
      "vulnerab",
      "脆弱性",
    ]) {
      expect(visible).not.toContain(forbidden);
    }
  });

  it("should keep the free hint tier free of the answer", () => {
    // The critique this problem was rebuilt from found a design whose zero-cost
    // hints gave away the break-glass location and the exact posts to read. A
    // free nudge that names the answer is a hint budget defeated without
    // exceeding it.
    const free = [
      ...metadata.scoring.checks.flatMap((check) =>
        (check.hints ?? []).filter((hint) => hint.penalty === 0),
      ),
    ].map((hint) => hint.id);
    expect(free.length).toBe(5);
    const freeText = JSON.stringify([
      ...metadata.scoring.checks.flatMap((check) =>
        (check.hints ?? []).filter((hint) => free.includes(hint.id)),
      ),
      ...metadata.i18n.en.checks.flatMap((check) =>
        (check.hints ?? []).filter((hint) => free.includes(hint.id)),
      ),
    ]).toLowerCase();
    for (const giveaway of [
      "docker compose logs",
      "board:count",
      "digest:publish",
      "x-break-glass",
      "revoke?keyid",
    ]) {
      expect(freeText).not.toContain(giveaway);
    }
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets, one full pass", () => {
  /**
   * `solved` is driven all the way through. `fresh` is an untouched starter on
   * the *same seed*, and every true answer harvested from `solved` is offered to
   * it — the check that a checkpoint is earned by the work rather than by the
   * string.
   */
  let solved: Instance;
  let fresh: Instance;
  const app = client(() => solved);
  const other = client(() => fresh);

  let leaked = "";
  let breakGlass = "";
  let newKeyId = "";
  let newFingerprint = "";
  let newSecret = "";
  let witness = "";
  let receipt = "";

  beforeAll(async () => {
    solved = await startInstance("pass", 18330, 18331);
    fresh = await startInstance("fresh", 18332, 18333);
  });
  afterAll(() => {
    solved?.kill();
    fresh?.kill();
  });

  it("should open with the service running and everything else red", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      leak_confirmed: false,
      key_rotated: false,
      legacy_revoked: false,
      least_privilege: false,
      service_intact: true,
    });
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
    // The one green gate is the one the CTO asked not to break: the nightly job
    // ran before the participant arrived and counted the board it can see.
    const summary = await app.state();
    expect(summary.digest.last.ok).toBe(true);
    expect(summary.digest.latest.count).toBe(2);
    expect(summary.identity).toBe(LEGACY_KEY_ID);
  });

  it("should ship a starter whose ops key can do everything in the catalogue", async () => {
    const policy = await app.policy();
    expect(policy.grants).toEqual(["*"]);
    expect(policy.denied).toEqual([]);
    expect(policy.allowed.length).toBe(policy.catalog.length);
    expect(policy.allowed.length).toBe(6);
    // Every prefix carrying an action the job needs also carries one it does
    // not, so no `service:*` can ever be narrow enough.
    for (const needed of DIGEST_ACTIONS) {
      const prefix = needed.split(":")[0] as string;
      const siblings = policy.catalog
        .map((entry) => entry.action)
        .filter((action) => action.startsWith(`${prefix}:`) && action !== needed);
      expect(siblings.length).toBeGreaterThan(0);
    }
  });

  it("should print one action's name from the seed, so no answer table survives", async () => {
    const policy = await app.policy();
    expect(policy.catalog.map((entry) => entry.action)).toContain(
      (await other.policy()).catalog.map((entry) => entry.action).find((a) => a.startsWith("plugin:")),
    );
    expect(policy.catalog.some((entry) => /^plugin:[0-9a-f]{6}$/.test(entry.action))).toBe(true);
  });

  it("should not say which actions this board needs, anywhere on the policy surface", async () => {
    // The critique's first fatal finding: a `required` flag on the public
    // catalogue answers the whole of `least-privilege` before it engages.
    const raw = (await app.get("/api/ops/policy")).text;
    for (const word of ["required", "necessary", "dangerous", "sensitive", "必須", "危険"]) {
      expect(raw.toLowerCase()).not.toContain(word);
    }
    expect((await app.get("/api/ops")).text.toLowerCase()).not.toContain("required");
  });

  it("should carry the ops key on the board, in full", async () => {
    leaked = await app.leakedSecret();
    expect(leaked).toMatch(/^SSOPS-[0-9a-f]{20}$/);
    const page = await app.get("/");
    expect(page.text).toContain(leaked);
  });

  it("should refuse an unrecognised credential and emit no witness", async () => {
    const refused = await app.whoami("SSOPS-0000000000000000000f");
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("ops_key_rejected");
    expect(refused.body.witness).toBeUndefined();
    expect((await app.whoami("")).status).toBe(401);
  });

  it("should identify the leaked credential, and say it still opens things", async () => {
    const identified = await app.whoami(leaked);
    expect(identified.status).toBe(200);
    expect(identified.body).toMatchObject({ keyId: LEGACY_KEY_ID, status: "active" });
    expect(identified.body.witness).toMatch(/^[0-9a-f]{12}$/);
    witness = identified.body.witness as string;
    // ...and it really works, not just identifies: the ops API executes for it.
    const acted = await app.act("board:count", leaked);
    expect(acted.status).toBe(200);
    expect(acted.body.effect.posts).toBe(2);
  });

  it("should raise leak_confirmed only once the credential was actually presented", async () => {
    expect((await app.posture()).gates.leak_confirmed).toBe(true);
    expect((await other.posture()).gates.leak_confirmed).toBe(false);
  });

  it("should credit leak-live for the witness, and for nothing else", async () => {
    expect(await app.correct("leak-live", witness)).toBe(true);
    expect(await app.correct("leak-live", ` ${witness} `)).toBe(true);
    expect(await app.correct("leak-live", (await app.key(LEGACY_KEY_ID))?.fingerprint ?? "")).toBe(false);
    expect(await app.correct("leak-live", leaked)).toBe(false);
  });

  it("should refuse the true witness on an instance where it was never presented", async () => {
    // The value is seed-derived and therefore identical on both instances. If
    // this passed, `leak-live` would be a 12-hex string anybody could carry from
    // a previous deploy rather than evidence that the key was tried.
    expect(await other.correct("leak-live", witness)).toBe(false);
    expect((await other.posture()).gates.leak_confirmed).toBe(false);
  });

  it("should never serve the break-glass credential over HTTP", async () => {
    breakGlass = breakGlassFrom(solved);
    expect(breakGlass).toMatch(/^[0-9a-f]{16}$/);
    for (const path of [
      "/",
      "/api/board",
      "/api/logs?limit=500",
      "/posture",
      "/healthz",
      "/api/ops",
      "/api/ops/keys",
      "/api/ops/policy",
      "/api/ops/state",
      "/api/ops/journal?limit=300",
    ]) {
      expect((await app.get(path)).text).not.toContain(breakGlass);
    }
    // The board's own log is served unauthenticated, so this is the assertion
    // that keeps the whole problem from collapsing into two GETs.
    expect(solved.stdout()).not.toContain(breakGlass);
  });

  it("should refuse to issue or revoke a key without it", async () => {
    expect((await app.post("/api/ops/keys")).status).toBe(401);
    expect((await app.mint("0".repeat(16))).status).toBe(401);
    expect((await app.revoke(LEGACY_KEY_ID, "0".repeat(16))).status).toBe(401);
    // ...and the ops key, however privileged, is not a way in either.
    expect((await app.act("keys:reveal", leaked)).status).toBe(200);
    expect((await app.keys()).length).toBe(1);
  });

  it("should issue a key, hand over its secret once, and never again", async () => {
    const issued = await app.mint(breakGlass);
    expect(issued.status).toBe(201);
    expect(issued.body.keyId).toMatch(/^ops-[0-9a-f]{6}$/);
    expect(issued.body.secret).toMatch(/^SSOPS-[0-9a-f]{20}$/);
    newKeyId = issued.body.keyId as string;
    newFingerprint = issued.body.fingerprint as string;
    newSecret = issued.body.secret as string;
    const secret = newSecret;
    expect(secret).not.toBe(leaked);

    for (const path of [
      "/api/ops/keys",
      "/api/ops/state",
      "/api/ops/journal?limit=300",
      "/api/logs?limit=500",
      "/api/ops",
      "/posture",
    ]) {
      expect((await app.get(path)).text).not.toContain(secret);
    }
    expect(solved.stdout()).not.toContain(secret);
    // It does work, though: the store really holds what it handed out.
    expect((await app.whoami(secret)).body.keyId).toBe(newKeyId);
  });

  it("should refuse to revoke the key the nightly job is running as", async () => {
    const refused = await app.revoke(LEGACY_KEY_ID, breakGlass);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("would_orphan_service");
    // And it really did not revoke it: the guardrail is not cosmetic.
    expect((await app.key(LEGACY_KEY_ID))?.status).toBe("active");
    expect((await app.runDigest()).status).toBe(200);
  });

  it("should refuse key-rotated while the job still runs as the leaked key", async () => {
    expect(await app.correct("key-rotated", newFingerprint)).toBe(false);
    expect(await app.correct("key-rotated", (await app.key(LEGACY_KEY_ID))?.fingerprint ?? "")).toBe(
      false,
    );
  });

  it("should refuse a manifest that holds a key instead of naming one", async () => {
    // Ending this problem with a fresh credential pasted into a tracked JSON
    // file would teach the opposite of what it set out to.
    app.writeManifest({ identity: leaked });
    const refused = await app.runDigest();
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe("secret_in_manifest");
    app.writeManifestRaw(JSON.stringify({ identity: newKeyId, grants: ["*", leaked] }));
    expect((await app.runDigest()).body.reason).toBe("secret_in_manifest");
  });

  it("should cut the nightly job over when the manifest names the new key", async () => {
    app.writeManifest({ identity: newKeyId, grants: ["*"] });
    const run = await app.runDigest();
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ ok: true, keyId: newKeyId });
    const state = await app.posture();
    expect(state.gates.key_rotated).toBe(true);
    expect(state.gates.service_intact).toBe(true);
    expect(state.gates.legacy_revoked).toBe(false);
  });

  it("should credit key-rotated for the fingerprint the job authenticated with", async () => {
    expect(await app.correct("key-rotated", newFingerprint)).toBe(true);
    expect(await app.correct("key-rotated", (await app.key(LEGACY_KEY_ID))?.fingerprint ?? "")).toBe(
      false,
    );
  });

  it("should refuse the new key's true fingerprint once the job is pointed back", async () => {
    // Harvested from the app, correct as a string, and wrong as an answer: the
    // fingerprint of a key that exists and is active, while the job runs as
    // something else. A handler loosened to "is this a fingerprint in the store"
    // passes here and nowhere else in this file.
    app.writeManifest({ identity: LEGACY_KEY_ID });
    expect((await app.runDigest()).body.keyId).toBe(LEGACY_KEY_ID);
    expect(await app.correct("key-rotated", newFingerprint)).toBe(false);
    app.writeManifest({ identity: newKeyId });
    expect(await app.correct("key-rotated", newFingerprint)).toBe(true);
  });

  it("should refuse the true fingerprint on the untouched instance", async () => {
    expect(await other.correct("key-rotated", newFingerprint)).toBe(false);
  });

  it("should refuse key-revoked while the leaked key is still active", async () => {
    expect((await app.key(LEGACY_KEY_ID))?.revocationReceipt).toBeNull();
    expect(await app.correct("key-revoked", "")).toBe(false);
    expect(await app.correct("key-revoked", "0".repeat(12))).toBe(false);
  });

  it("should revoke the leaked key once nothing depends on it", async () => {
    const revoked = await app.revoke(LEGACY_KEY_ID, breakGlass);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revocationReceipt).toMatch(/^[0-9a-f]{12}$/);
    receipt = revoked.body.revocationReceipt as string;
    expect((await app.key(LEGACY_KEY_ID))?.revocationReceipt).toBe(receipt);
    // Revoking twice is refused rather than silently re-issuing a receipt.
    const again = await app.revoke(LEGACY_KEY_ID, breakGlass);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_revoked");
  });

  it("should still identify the revoked credential, and open nothing with it", async () => {
    const identified = await app.whoami(leaked);
    expect(identified.status).toBe(200);
    expect(identified.body).toMatchObject({ keyId: LEGACY_KEY_ID, status: "revoked" });
    expect(identified.body.witness).toBe(witness);
    for (const action of ["board:count", "board:export", "keys:reveal"]) {
      const acted = await app.act(action, leaked);
      expect(acted.status).toBe(401);
      expect(acted.body.error).toBe("ops_key_rejected");
    }
    // The refusal is recorded — the audit trail is the point of a journal.
    const entries = await app.journal();
    expect(entries.some((e) => e.keyId === LEGACY_KEY_ID && e.outcome === "rejected")).toBe(true);
    expect(
      entries.filter((e) => e.keyId === LEGACY_KEY_ID && e.outcome === "allowed").length,
    ).toBeGreaterThan(0); // from before the revoke, so "no allowed *after*" is a real claim
  });

  it("should keep leak-live answerable after the credential is closed", async () => {
    // Revoke-then-collect-your-evidence is a legal order of play. A design where
    // `whoami` 401'd a revoked key would soft-lock 40 points behind doing things
    // in the other order.
    expect(await app.correct("leak-live", witness)).toBe(true);
  });

  it("should credit key-revoked for the receipt a completed revoke produced", async () => {
    expect(await app.correct("key-revoked", receipt)).toBe(true);
    expect(await app.correct("key-revoked", `${receipt}0`)).toBe(false);
    expect(await app.correct("key-revoked", witness)).toBe(false);
  });

  it("should really present the closed credential when it grades the revocation", async () => {
    // The absence half of `key-revoked` is a live request, not a field read, and
    // the journal is where that shows: grading must leave a scorer-sourced
    // refusal for the closed key behind it, and no allowed entry for it.
    const before = (await app.journal()).length;
    expect(await app.correct("key-revoked", receipt)).toBe(true);
    const added = (await app.journal()).slice(before);
    expect(
      added.some(
        (entry) =>
          entry.source === "scorer" && entry.keyId === LEGACY_KEY_ID && entry.outcome === "rejected",
      ),
    ).toBe(true);
    expect(added.some((entry) => entry.keyId === LEGACY_KEY_ID && entry.outcome === "allowed")).toBe(
      false,
    );
  });

  it("should refuse the true receipt on the untouched instance", async () => {
    expect(await other.correct("key-revoked", receipt)).toBe(false);
    expect((await other.key(LEGACY_KEY_ID))?.status).toBe("active");
  });

  it("should refuse the true receipt while the service the fix protects is down", async () => {
    // The value is real and permanent; the correctness precondition is not. A
    // regression that dropped the "the job still works" half would award 45
    // points for a container whose nightly job cannot run at all.
    app.writeManifest({ grants: [] });
    expect((await app.runDigest()).status).toBe(409);
    expect(await app.correct("key-revoked", receipt)).toBe(false);
    app.writeManifest({ grants: ["*"] });
    expect(await app.correct("key-revoked", receipt)).toBe(true);
  });

  it("should count the board it can actually see, not a number it was born with", async () => {
    // `least-privilege`'s correctness precondition is that a required action
    // really works, and it checks the *value*, not just the 200. Make the board
    // a different size than the one it shipped with, so a `board:count` rewired
    // to answer a constant — the classic "fixed response" cheap fix — cannot
    // satisfy that precondition.
    const posted = await fetch(`${solved.board}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "new-sre", title: "handover notes", body: "day three" }),
    });
    expect(posted.status).toBe(201);
    const counted = await app.act("board:count", newSecret);
    expect(counted.status).toBe(200);
    expect(counted.body.effect.posts).toBe(3);
    expect((await app.get("/api/board")).body.posts).toHaveLength(3);
  });

  it("should refuse least-privilege while the ops key can do everything", async () => {
    const policy = await app.policy();
    expect(policy.denied).toEqual([]);
    const state = await app.posture();
    expect(state.gates.least_privilege).toBe(false);
    expect(state.tokens.least_privilege).toBeNull();
    // Harvested from the app in the state that must not pass: the policy digest
    // really on `/api/ops/policy` right now.
    expect(await app.correct("least-privilege", policy.digest)).toBe(false);
  });

  it("should refuse every wildcard that leaves a sensitive sibling reachable", async () => {
    for (const grants of [["*"], ["*:*"], ["board:*", "digest:*"], ["board:*", "digest:publish"]]) {
      app.writeManifest({ grants });
      expect((await app.runDigest()).status).toBe(200);
      const state = await app.posture();
      expect(state.gates.least_privilege).toBe(false);
      const policy = await app.policy();
      expect(await app.correct("least-privilege", policy.digest)).toBe(false);
      // ...and name the sibling that let it through, so this is not passing for
      // some unrelated reason.
      expect(policy.allowed.some((action) => !DIGEST_ACTIONS.includes(action))).toBe(true);
    }
  });

  it("should match a grant segment for segment, never as a prefix", async () => {
    // `board` is not `board:*`, and `board:count:extra` is not `board:count`. A
    // matcher that compared only as far as the shorter side would make every
    // service name a silent wildcard.
    for (const grants of [["board", "digest"], ["board:count:extra"], ["", " "].slice(0, 0)]) {
      if (grants.length === 0) continue;
      app.writeManifest({ grants });
      const policy = await app.policy();
      expect(policy.allowed).toEqual([]);
      expect(policy.denied.length).toBe(policy.catalog.length);
      expect((await app.runDigest()).status).toBe(409);
      expect((await app.posture()).gates.service_intact).toBe(false);
    }
  });

  it("should refuse a policy too narrow for the job to run", async () => {
    for (const grants of [[], ["board:count"], ["digest:publish"], ["keys:reveal"]]) {
      app.writeManifest({ grants });
      const state = await app.posture();
      expect(state.gates.least_privilege).toBe(false);
      expect(state.gates.service_intact).toBe(false);
      expect(await app.correct("least-privilege", (await app.policy()).digest)).toBe(false);
    }
  });

  it("should credit least-privilege for the receipt of the gate that measures it", async () => {
    app.writeManifest({ grants: DIGEST_ACTIONS });
    expect((await app.runDigest()).status).toBe(200);
    const state = await app.posture();
    expect(state.gates.least_privilege).toBe(true);
    const token = state.tokens.least_privilege as string;
    expect(token).toMatch(/^TC\{least_privilege_[0-9a-f]{16}\}$/);
    expect(await app.correct("least-privilege", token)).toBe(true);
    expect(await app.correct("least-privilege", token.slice(0, -1))).toBe(false);
    expect(await app.correct("least-privilege", (await app.policy()).digest)).toBe(false);
  });

  it("should refuse the true receipt the moment the policy widens again", async () => {
    // Same instance, so the receipt string is unchanged — only the measured
    // state moved. This is the assertion a checkpoint whose earned value got
    // stamped onto the failure path would fail.
    const token = (await app.posture()).tokens.least_privilege as string;
    app.writeManifest({ grants: ["*"] });
    expect((await app.runDigest()).status).toBe(200);
    expect(await app.correct("least-privilege", token)).toBe(false);
    app.writeManifest({ grants: DIGEST_ACTIONS });
    expect((await app.runDigest()).status).toBe(200);
    expect(await app.correct("least-privilege", token)).toBe(true);
  });

  it("should emit the sign-off only once all five gates are green", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      leak_confirmed: true,
      key_rotated: true,
      legacy_revoked: true,
      least_privilege: true,
      service_intact: true,
    });
    expect(state.ready).toBe(true);
    expect(state.readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
    expect(await app.correct("sign-off", state.readyToken as string)).toBe(true);
  });

  it("should refuse a sign-off captured while green once anything regresses", async () => {
    const token = (await app.posture()).readyToken as string;
    app.writeManifest({ grants: ["*"] });
    expect((await app.runDigest()).status).toBe(200);
    expect((await app.posture()).readyToken).toBeNull();
    expect(await app.correct("sign-off", token)).toBe(false);
    app.writeManifest({ grants: DIGEST_ACTIONS });
    expect((await app.runDigest()).status).toBe(200);
    expect(await app.correct("sign-off", token)).toBe(true);
  });

  it("should refuse the true sign-off on the untouched instance", async () => {
    // `readyToken` is derived from FLAG_SEED, so both instances agree on the
    // string. Only one of them did the work.
    const token = (await app.posture()).readyToken as string;
    expect((await other.posture()).readyToken).toBeNull();
    expect(await other.correct("sign-off", token)).toBe(false);
  });

  it("should fail every checkpoint on the untouched starter, on real values", async () => {
    // The whole-problem version of "no vacuous pass", with the true answers
    // rather than guesses: nothing about the shipped state earns anything.
    const solvedState = await app.posture();
    const truths: Record<string, string> = {
      "leak-live": witness,
      "key-rotated": newFingerprint,
      "key-revoked": receipt,
      // From `solved`, like every other row. This read `other.posture()` — the
      // untouched instance, where the gate is false and the token is therefore
      // null, so `?? ""` handed the loop an empty string. The checkpoint refused
      // it for being empty rather than for being another instance's receipt, so
      // the one row whose gate is cheapest to raise was the row testing nothing.
      "least-privilege": solvedState.tokens.least_privilege as string,
      "sign-off": solvedState.readyToken as string,
    };
    // The map is written by hand and the loop below reads it by metadata's ids.
    // Let those drift and `truths[check.id]` is `undefined`, the checkpoint
    // refuses it for being nothing rather than for being another instance's
    // answer, and this goes green while testing none of what it names —
    // verified by deleting an entry, which left it passing. So the keys are
    // pinned to the ids and every value has to be a real one.
    expect(Object.keys(truths).sort()).toEqual(
      metadata.scoring.checks.map((check) => check.id).sort(),
    );
    for (const [id, truth] of Object.entries(truths)) {
      expect(truth, `${id} has no true answer to offer`).toBeTypeOf("string");
      expect(truth.length, `${id}'s true answer is empty`).toBeGreaterThan(0);
    }
    for (const check of metadata.scoring.checks) {
      expect(await other.correct(check.id, truths[check.id] as string)).toBe(false);
      expect(await other.correct(check.id, (await other.policy()).digest)).toBe(false);
    }
    const state = await other.posture();
    expect(state.gates).toEqual({
      leak_confirmed: false,
      key_rotated: false,
      legacy_revoked: false,
      least_privilege: false,
      service_intact: true,
    });
  });

  it("should reject an empty, truncated or extended submission on every checkpoint", async () => {
    // Guards against a handler loosened to a substring or truthiness test.
    const answers: Record<string, string> = {
      "leak-live": witness,
      "key-rotated": newFingerprint,
      "key-revoked": receipt,
      "least-privilege": (await app.posture()).tokens.least_privilege as string,
      "sign-off": (await app.posture()).readyToken as string,
    };
    for (const check of metadata.scoring.checks) {
      const right = answers[check.id] as string;
      expect(right).toBeTruthy();
      expect(await app.correct(check.id, "")).toBe(false);
      expect(await app.correct(check.id, "   ")).toBe(false);
      expect(await app.correct(check.id, right.slice(0, -1))).toBe(false);
      expect(await app.correct(check.id, `${right}x`)).toBe(false);
      // ...and the true answer still passes, so the four assertions above are
      // not passing merely because the checkpoint rejects everything.
      expect(await app.correct(check.id, right)).toBe(true);
    }
  });

  it("should not credit one checkpoint's answer to another", async () => {
    const answers: Record<string, string> = {
      "leak-live": witness,
      "key-rotated": newFingerprint,
      "key-revoked": receipt,
      "least-privilege": (await app.posture()).tokens.least_privilege as string,
      "sign-off": (await app.posture()).readyToken as string,
    };
    for (const [owner, value] of Object.entries(answers)) {
      for (const check of metadata.scoring.checks) {
        if (check.id === owner) continue;
        expect(await app.correct(check.id, value)).toBe(false);
      }
    }
  });

  it("should leave the participant's environment exactly as it found it", async () => {
    // Scoring runs the nightly job (append-only) and probes read-only actions.
    // Nothing it does may change a key, a policy, or the board.
    const before = await app.state();
    const keysBefore = await app.keys();
    const boardBefore = (await app.get("/api/board")).text;
    for (const check of metadata.scoring.checks) {
      await app.answer(check.id, "definitely-wrong");
      await app.answer(check.id, "");
    }
    const after = await app.state();
    expect(await app.keys()).toEqual(keysBefore);
    expect((await app.get("/api/board")).text).toBe(boardBefore);
    expect(after.identity).toBe(before.identity);
    expect(after.policy).toEqual(before.policy);
    // The digest archive is allowed to grow — that is the job running — and
    // nothing else is.
    expect(after.digest.runs).toBeGreaterThanOrEqual(before.digest.runs);
  });

  it("should mark its own probes in the journal, and raise no gate with them", async () => {
    const entries = await app.journal();
    expect(entries.some((entry) => entry.source === "scorer")).toBe(true);
    expect(entries.some((entry) => entry.source === "ops")).toBe(true);
    // The scorer presented the leaked secret while grading key-revoked. On the
    // untouched instance nothing has, and answering there must not change that.
    await other.answer("key-revoked", "anything");
    await other.answer("leak-live", witness);
    expect((await other.posture()).gates.leak_confirmed).toBe(false);
  });

  it("should stay well throughout: no uncaught fault was taken", async () => {
    for (const instance of [solved, fresh]) {
      const response = await fetch(`${instance.board}/healthz`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { faults: unknown[] }).faults).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets gates on a fresh instance", () => {
  /**
   * Every gate raised on its own, with at least one other still false. The pass
   * above only ever ends with them green, so a gate hardcoded to `true` would
   * survive it — `least_privilege: () => true` being the dangerous one, since it
   * hands the sign-off to a key that can still export the whole board.
   */
  let instance: Instance;
  const app = client(() => instance);
  let leaked = "";
  let breakGlass = "";

  beforeAll(async () => {
    instance = await startInstance("gates", 18334, 18335);
    leaked = await app.leakedSecret();
    breakGlass = breakGlassFrom(instance);
  });
  afterAll(() => instance?.kill());

  it("should start with one gate green and no sign-off token", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      leak_confirmed: false,
      key_rotated: false,
      legacy_revoked: false,
      least_privilege: false,
      service_intact: true,
    });
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
    expect(state.tokens.least_privilege).toBeNull();
  });

  it("should raise least_privilege on its own, with the leaked key still in charge", async () => {
    app.writeManifest({ grants: DIGEST_ACTIONS });
    expect((await app.runDigest()).status).toBe(200);
    const state = await app.posture();
    expect(state.gates.least_privilege).toBe(true);
    expect(state.gates.key_rotated).toBe(false);
    expect(state.gates.legacy_revoked).toBe(false);
    expect(state.gates.leak_confirmed).toBe(false);
    expect(state.readyToken).toBeNull();
    // Narrowing the policy without touching the key earns 45 of 200 and no more.
    expect(await app.correct("least-privilege", state.tokens.least_privilege as string)).toBe(true);
    expect(await app.correct("sign-off", "TC{ready_0000000000000000}")).toBe(false);
  });

  it("should raise leak_confirmed on its own", async () => {
    expect((await app.whoami(leaked)).status).toBe(200);
    const state = await app.posture();
    expect(state.gates.leak_confirmed).toBe(true);
    expect(state.gates.key_rotated).toBe(false);
    expect(state.gates.legacy_revoked).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should raise key_rotated on its own, before anything is revoked", async () => {
    const issued = await app.mint(breakGlass);
    app.writeManifest({ identity: issued.body.keyId as string });
    expect((await app.runDigest()).status).toBe(200);
    const state = await app.posture();
    expect(state.gates.key_rotated).toBe(true);
    expect(state.gates.legacy_revoked).toBe(false);
    expect(state.readyToken).toBeNull();
    // The leaked key is untouched and still works — rotation is not revocation.
    expect((await app.act("board:count", leaked)).status).toBe(200);
  });

  it("should raise legacy_revoked last, and only then hand out the sign-off", async () => {
    const stillWaiting = await app.posture();
    expect(stillWaiting.gates.legacy_revoked).toBe(false);
    expect(stillWaiting.ready).toBe(false);

    expect((await app.revoke(LEGACY_KEY_ID, breakGlass)).status).toBe(200);
    const done = await app.posture();
    expect(done.gates.legacy_revoked).toBe(true);
    expect(done.ready).toBe(true);
    expect(done.readyToken).not.toBeNull();
    expect(await app.correct("sign-off", done.readyToken as string)).toBe(true);
  });

  it("should turn service_intact red the moment the job stops working", async () => {
    // The gate the CTO cares about, asserted in the direction that matters.
    app.writeManifest({ grants: ["board:count"] });
    const state = await app.posture();
    expect(state.gates.service_intact).toBe(false);
    expect(state.gates.least_privilege).toBe(false);
    expect(state.readyToken).toBeNull();
    const refused = await app.runDigest();
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toContain("digest:publish");
  });

  it("should turn service_intact red when the manifest points at a revoked key", async () => {
    app.writeManifest({ identity: LEGACY_KEY_ID, grants: DIGEST_ACTIONS });
    const refused = await app.runDigest();
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe("identity_revoked");
    expect((await app.posture()).gates.service_intact).toBe(false);
  });

  it("should not raise a gate for a route it 404s", async () => {
    const before = await app.posture();
    expect((await app.get("/api/ops/not-really")).status).toBe(404);
    expect((await app.posture()).gates).toEqual(before.gates);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets refuses the cheap fixes", () => {
  let instance: Instance;
  const app = client(() => instance);
  let leaked = "";
  let breakGlass = "";

  beforeAll(async () => {
    instance = await startInstance("cheap", 18336, 18337);
    leaked = await app.leakedSecret();
    breakGlass = breakGlassFrom(instance);
  });
  afterAll(() => instance?.kill());

  it("should give the board no way to take the leak down", async () => {
    // The leak surface is deliberately un-deletable. If it were removable, the
    // shortest path through this problem would teach "delete the evidence".
    for (const method of ["DELETE", "PUT", "PATCH"]) {
      const response = await fetch(`${instance.board}/api/board`, { method });
      expect(response.status).toBe(404);
    }
    expect((await app.get("/api/board")).text).toContain(leaked);
  });

  it("should not care that the key is exportable by a second route", async () => {
    // `board:export` is a real second copy of the credential, and closing that
    // route changes nothing about whether the credential works.
    expect((await app.act("board:export", leaked)).text).toContain(leaked);
    app.writeManifest({ grants: DIGEST_ACTIONS });
    expect((await app.act("board:export", leaked)).status).toBe(403);
    expect((await app.act("board:count", leaked)).status).toBe(200);
    expect((await app.whoami(leaked)).body.status).toBe("active");
    expect(await app.correct("key-revoked", "0".repeat(12))).toBe(false);
    expect((await app.key(LEGACY_KEY_ID))?.revocationReceipt).toBeNull();
  });

  it("should refuse every checkpoint when the ops API is made unusable", async () => {
    // The "satisfy the absence by making everything absent" attack. Both
    // absence-shaped checkpoints run the required side first.
    app.writeManifest({ grants: [] });
    expect((await app.runDigest()).status).toBe(409);
    for (const check of metadata.scoring.checks) {
      expect(await app.correct(check.id, "anything")).toBe(false);
    }
    const state = await app.posture();
    expect(state.gates.service_intact).toBe(false);
    expect(state.gates.least_privilege).toBe(false);
  });

  it("should not let a revoked key be a way to satisfy anything", async () => {
    // Revoke everything: the leaked key is closed, and so is the service.
    app.writeManifest({ grants: ["*"] });
    const issued = await app.mint(breakGlass);
    app.writeManifest({ identity: issued.body.keyId as string });
    expect((await app.runDigest()).status).toBe(200);
    const revoked = await app.revoke(LEGACY_KEY_ID, breakGlass);
    const receipt = revoked.body.revocationReceipt as string;
    expect(await app.correct("key-revoked", receipt)).toBe(true);

    app.writeManifest({ identity: LEGACY_KEY_ID });
    expect((await app.runDigest()).status).toBe(409);
    expect(await app.correct("key-revoked", receipt)).toBe(false);
    expect(await app.correct("key-rotated", issued.body.fingerprint as string)).toBe(false);
    app.writeManifest({ identity: issued.body.keyId as string });
    expect(await app.correct("key-revoked", receipt)).toBe(true);
  });

  it("should answer a refused job with 409 and a reason, never a 5xx", async () => {
    for (const raw of [
      "{ this is not json",
      "[]",
      JSON.stringify({ grants: ["*"] }),
      JSON.stringify({ identity: "ops-legacy", grants: ["*"], role: "owner" }),
      JSON.stringify({ identity: "ops-legacy", grants: "board:count" }),
      JSON.stringify({ identity: "no-such-key", grants: ["*"] }),
    ]) {
      app.writeManifestRaw(raw);
      const refused = await app.runDigest();
      expect(refused.status).toBe(409);
      expect(refused.body.ok).toBe(false);
      expect(refused.body.detail.length).toBeGreaterThan(0);
      expect((await app.get("/healthz")).status).toBe(200);
      // ...and the console still renders rather than throwing on a bad file.
      expect((await app.get("/api/ops")).status).toBe(200);
    }
  });

  it("should refuse an action it does not have, without inventing one", async () => {
    app.writeManifestRaw(JSON.stringify({ identity: LEGACY_KEY_ID, grants: ["*"] }));
    for (const action of ["", "board", "board:count:extra", "no-such:action", "__proto__"]) {
      const response = await app.act(action, leaked);
      expect(response.status).toBe(401); // ops-legacy is revoked on this instance
    }
    const issued = await app.mint(breakGlass);
    for (const action of ["", "board", "board:count:extra", "no-such:action", "__proto__"]) {
      const response = await app.act(action, issued.body.secret as string);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_action");
    }
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets keeps its answers inside the container", () => {
  it("should commit no ops secret anywhere in the problem or the shared base", () => {
    // Two instances on different seeds. Every `SSOPS-…` either of them emits
    // must appear nowhere in the tree — which catches a committed answer without
    // needing to reason about which file holds the derivation.
    const files = [
      join(PROBLEM_DIR, "metadata.json"),
      join(PROBLEM_DIR, "README.md"),
      join(PROBLEM_DIR, "README.ja.md"),
      join(PROBLEM_DIR, "local", "ops", "ops.json"),
      join(PROBLEM_DIR, "local", "config", "app.json"),
      join(PROBLEM_DIR, "local", "docker-compose.yml"),
      SCENARIO_FILE,
      join(REPO_ROOT, "stackstack-base", "app", "secrets.mjs"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // The prefix appears as a constant in the scenario; a *value* never does.
      expect(text).not.toMatch(/SSOPS-[0-9a-f]{8}/);
    }
  });

  it("should derive every answer from the seed, so no two deploys agree", async () => {
    const [left, right] = await Promise.all([
      startInstance("seed-a", 18338, 18339, { seed: "seed-alpha" }),
      startInstance("seed-b", 18330, 18331, { seed: "seed-bravo" }),
    ]);
    try {
      const a = client(() => left);
      const b = client(() => right);
      expect(await a.leakedSecret()).not.toBe(await b.leakedSecret());
      expect(breakGlassFrom(left)).not.toBe(breakGlassFrom(right));
      expect((await a.key(LEGACY_KEY_ID))?.fingerprint).not.toBe(
        (await b.key(LEGACY_KEY_ID))?.fingerprint,
      );
      expect((await a.whoami(await a.leakedSecret())).body.witness).not.toBe(
        (await b.whoami(await b.leakedSecret())).body.witness,
      );
      expect((await a.policy()).digest).not.toBe((await b.policy()).digest);
      // Even the action catalogue differs, so a written-down list of actions to
      // refuse is wrong on the next deploy.
      const pluginOf = async (api: ReturnType<typeof client>) =>
        (await api.policy()).catalog.map((entry) => entry.action).find((a) => a.startsWith("plugin:"));
      expect(await pluginOf(a)).not.toBe(await pluginOf(b));
    } finally {
      left.kill();
      right.kill();
    }
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets /verify contract and robustness", () => {
  let instance: Instance;
  const app = client(() => instance);

  beforeAll(async () => {
    instance = await startInstance("verify", 18332, 18333);
  });
  afterAll(() => instance?.kill());

  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    // Imported rather than grepped: this scenario carries a key store, a policy
    // engine and a route table, and a regex over two-space-indented keys would
    // match dozens of unrelated things and assert nothing.
    const scenario = (await import(SCENARIO_FILE)) as { checks: Record<string, unknown> };
    expect(Object.keys(scenario.checks).sort()).toEqual(
      metadata.scoring.checks.map((check) => check.id).sort(),
    );
    for (const check of metadata.scoring.checks) {
      const response = await app.answer(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
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

  it("should survive a request target it cannot even parse", async () => {
    // Both servers share one process: an unhandled throw here would end the
    // participant's session over a typo.
    await new Promise<void>((resolve) => {
      const socket = connect(18332, "127.0.0.1", () => {
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
    expect((await fetch("http://127.0.0.1:18333/healthz")).ok).toBe(true);
  });

  it("should answer an oversize body rather than resetting the socket", async () => {
    const response = await fetch(`${instance.board}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "a", title: "b", body: "x".repeat(70 * 1024) }),
    });
    expect(response.status).toBe(413);
  });

  it("should escape a post the participant wrote before putting it on the page", async () => {
    await fetch(`${instance.board}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "me", title: "<img src=x onerror=alert(1)>", body: "hi" }),
    });
    const page = await app.get("/");
    expect(page.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page.text).not.toContain("<img src=x");
  });

  it("should keep the boot lines reachable however much later traffic arrives", async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) await app.get(`/nope-${attempt}`);
    const logs = await app.get("/api/logs");
    expect(
      logs.body.lines.some((line: { message: string }) => line.message.startsWith("boot ok")),
    ).toBe(true);
  });

  it("should hold the journal to a bounded size under sustained traffic", async () => {
    const secret = await app.leakedSecret();
    for (let attempt = 0; attempt < 320; attempt += 1) await app.act("board:count", secret);
    expect((await app.journal()).length).toBeLessThanOrEqual(300);
  });

  it("should stay well throughout: no uncaught fault was taken", async () => {
    const health = await app.get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body.faults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets leaves the shared base alone", () => {
  let instance: Instance;

  beforeAll(async () => {
    instance = await startInstance("onboarding", 18334, 18335, {
      scenario: "onboarding",
      sourceDir: ONBOARDING_DIR,
    });
  });
  afterAll(() => instance?.kill());

  it("should not grow an ops surface on a scenario that never declared one", async () => {
    // Routes come from the scenario, so onboarding's 404 behaviour is unchanged.
    for (const path of [
      "/api/ops",
      "/api/ops/keys",
      "/api/ops/whoami",
      "/api/ops/policy",
      "/api/ops/journal",
      "/api/ops/state",
    ]) {
      expect((await fetch(`${instance.board}${path}`)).status).toBe(404);
    }
  });

  it("should leave onboarding's gate set exactly as it was", async () => {
    const state = (await (await fetch(`${instance.board}/posture`)).json()) as Posture & {
      tokens?: unknown;
    };
    expect(Object.keys(state.gates).sort()).toEqual([
      "board_visited",
      "logs_read",
      "post_created",
      "posts_open",
    ]);
    // Receipts are opt-in, and onboarding does not opt in.
    expect(state.tokens).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-secrets wiring", () => {
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
    const published = [...new Set(service.ports.map((entry) => Number(entry.split(":")[1])))].sort(
      (a, b) => a - b,
    );
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    expect(existsSync(join(composeDir, service.build.context, service.build.dockerfile))).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("secrets");
    expect(
      existsSync(join(composeDir, service.build.context, "app", "scenarios", "secrets.mjs")),
    ).toBe(true);
  });

  it("should mount both participant-owned directories read-only", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro", "./ops:/app/ops:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "ops", "ops.json"))).toBe(true);
  });

  it("should name both files as the participant sees them, from the platform checkout", () => {
    // A participant runs `make local` from the TenkaCloud repository, where this
    // catalog is the `problems/` submodule. Printing this repo's own relative
    // path would send them to a file that does not exist on their machine.
    for (const [hint, inThisRepo] of [
      [service.environment.OPS_HINT, "challenges/stackstack-secrets/local/ops/ops.json"],
      [service.environment.CONFIG_HINT, "challenges/stackstack-secrets/local/config/app.json"],
    ] as const) {
      expect(hint).toBe(`problems/${inThisRepo}`);
      expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
    }
  });

  it("should give the participant-facing docs the same manifest path the app prints", () => {
    const hint = service.environment.OPS_HINT as string;
    for (const name of ["README.md", "README.ja.md"]) {
      expect(readFileSync(join(PROBLEM_DIR, name), "utf8")).toContain(hint);
    }
    expect(readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8")).toContain(hint);
  });

  it("should ship a manifest that is broken in exactly the two documented ways", () => {
    const manifest = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "ops", "ops.json"), "utf8"),
    ) as { identity: string; grants: string[] };
    expect(manifest.identity).toBe(LEGACY_KEY_ID);
    expect(manifest.grants).toEqual(["*"]);
    expect(Object.keys(manifest).sort()).toEqual(["grants", "identity"]);
  });

  it("should ship a board config this problem is not about", () => {
    const config = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    expect(config.acceptingPosts).toBe(true);
  });

  it("should ship an architecture diagram the portal can render", () => {
    const svg = readFileSync(join(PROBLEM_DIR, "diagram.svg"), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    // A diagram is participant-facing: it must not print an answer either.
    expect(svg).not.toMatch(/SSOPS-[0-9a-f]/);
  });

  it("should keep the two READMEs materially equivalent", () => {
    // AGENT.md §1a: equivalent in story, deployment model, play flow, scoring
    // and cost. Checked on the load-bearing facts rather than by translation.
    const english = readFileSync(join(PROBLEM_DIR, "README.md"), "utf8");
    const japanese = readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8");
    for (const anchor of [
      "GET /api/ops/whoami",
      "POST /api/ops/keys",
      "POST /api/ops/keys/revoke?keyId=ops-legacy",
      "POST /api/ops/digest/run",
      "GET /api/ops/journal",
      "127.0.0.1:18080/api/ops",
      "127.0.0.1:18081",
      OPS_HINT,
      "make local PROBLEM=stackstack-secrets",
      "git -C problems checkout -- challenges/stackstack-secrets/local/",
      "18 / 18 / 22 / 22 / 14",
      "would_orphan_service",
      "secret_in_manifest",
      "AdministratorAccess",
    ]) {
      expect(english).toContain(anchor);
      expect(japanese).toContain(anchor);
    }
    for (const points of metadata.scoring.checks.map((check) => String(check.points))) {
      expect(english).toContain(points);
      expect(japanese).toContain(points);
    }
  });

  it("should say plainly in both READMEs what the container does not model", () => {
    for (const name of ["README.md", "README.ja.md"]) {
      const text = readFileSync(join(PROBLEM_DIR, name), "utf8");
      expect(text).toContain("CloudTrail");
      expect(text).toContain("IAM");
    }
    expect(readFileSync(join(PROBLEM_DIR, "README.md"), "utf8")).toContain(
      "Only the lifecycle and the ordering are modelled",
    );
    expect(readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8")).toContain(
      "模しているのはライフサイクルと順序だけです",
    );
  });
});
