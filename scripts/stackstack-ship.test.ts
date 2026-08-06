import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-ship grades a release path, and a release path is only worth
 * anything if the thing at the far end of it actually answers. So these tests
 * drive the real app over real HTTP under Bun — deploy, rotate, delete, probe —
 * rather than asserting on the scenario's source text.
 *
 * The two participant-owned files (the release manifest and the board config)
 * are copied into a scratch directory first. The suite edits the manifest the
 * way a participant does, and must not leave the repository's shipped one
 * rewritten.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-ship");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");
const SCENARIO_FILE = join(REPO_ROOT, "stackstack-base", "app", "scenarios", "ship.mjs");

const SEED = "stackstack-ship-test-seed";

/** The value the shipped manifest carries, which `published-title` never credits. */
const LAPTOP_TITLE = "board (built on a laptop)";
/** The stale artifact id the predecessor's manifest names. */
const STALE_ARTIFACT = "board-2f9c81ae";

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

let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-ship-"));
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
}

/**
 * Start one real app on its own ports, with its own copies of the two
 * participant-owned files.
 */
async function startInstance(name: string, challengePort: number, verifyPort: number) {
  const manifestPath = join(scratch, `${name}-release.json`);
  // 上書きの置き場は共有 /tmp ではなくインスタンスごとの scratch。 スイートを並走させても、
  // 前回の実行が残した上書きを拾っても、 互いに汚染しない。
  const overrideDir = join(scratch, `${name}-overrides`);
  mkdirSync(overrideDir, { recursive: true });
  const configPath = join(scratch, `${name}-app.json`);
  writeFileSync(manifestPath, readFileSync(join(PROBLEM_DIR, "local", "release", "release.json")));
  writeFileSync(configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));

  let stdout = "";
  const child = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "ship",
      FLAG_SEED: SEED,
      APP_CONFIG: configPath,
      RELEASE_MANIFEST: manifestPath,
      APP_OVERRIDE_DIR: overrideDir,
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
    verify: `http://127.0.0.1:${verifyPort}/verify`,
    manifestPath,
    configPath,
    kill: () => child.kill(),
    stdout: () => stdout,
  };
  return instance;
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
  return {
    get: (path: string) => json(path),
    post: (path: string) => json(path, { method: "POST" }),
    remove: (path: string) => json(path, { method: "DELETE" }),
    patchSettings: (settings: Record<string, unknown>) =>
      json("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      }),
    resetSettings: () => json("/api/settings", { method: "DELETE" }),
    deploy: () => json("/shipyard/releases", { method: "POST" }),
    posture: async () =>
      (await json("/posture")).body as {
        gates: Record<string, boolean>;
        tokens: Record<string, string | null>;
        ready: boolean;
        readyToken: string | null;
      },
    site: () => json("/site/healthz"),
    settings: {
      get: () => json("/api/settings"),
      patch: (body: unknown) =>
        json("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      discard: () => json("/api/settings", { method: "DELETE" }),
    },
    /** Rewrite the manifest the way an editor save does. */
    writeManifest(patch: { artifact?: string; env?: Record<string, unknown>; [key: string]: unknown }) {
      const current = JSON.parse(readFileSync(instance().manifestPath, "utf8")) as Record<string, unknown>;
      const next = { ...current, ...patch };
      if (patch.env !== undefined) {
        next.env = { ...(current.env as Record<string, unknown>), ...patch.env };
      }
      writeFileSync(instance().manifestPath, JSON.stringify(next, null, 2));
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
    async secretValue() {
      return ((await json("/shipyard/secrets/value")).body as { value: string }).value;
    },
  };
}

// ---------------------------------------------------------------------------

describe("stackstack-ship scoring regulation", () => {
  it("should be a Medium-tier problem worth exactly 200 points", () => {
    expect(metadata.difficulty).toBe(3);
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
    expect(spent).toBe(84);
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

  it("should not publish the answer key in the hint that costs least", () => {
    // The reference-vs-copy binding is what the 60-point checkpoint measures.
    // A cheaper checkpoint's hint handing it over would sell that insight at a
    // discount, which is how a hint budget gets defeated without exceeding it.
    const cheap = metadata.scoring.checks
      .filter((check) => check.id !== "rotation-survives")
      .flatMap((check) => check.hints ?? []);
    const english = metadata.i18n.en.checks
      .filter((check) => check.id !== "rotation-survives")
      .flatMap((check) => check.hints ?? []);
    const ids = new Set([...cheap, ...english].map((hint) => hint.id));
    const text = JSON.stringify(
      [...metadata.scoring.checks, ...metadata.i18n.en.checks]
        .flatMap((check) => check.hints ?? [])
        .filter((hint) => ids.has(hint.id)),
    );
    expect(text).not.toContain("fromSecret");
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-ship, one full pass", () => {
  let instance: Instance;
  const app = client(() => instance);
  let artifactId = "";
  let publicSerial = "";
  const chosenTitle = "天下クラウド 掲示板 <公開>";

  beforeAll(async () => {
    instance = await startInstance("pass", 18310, 18311);
  });
  afterAll(() => instance?.kill());

  it("should change and reset the release manifest through the API without touching its source", async () => {
    const source = readFileSync(instance.manifestPath, "utf8");
    const changed = await app.patchSettings({ artifact: "board-from-api" });
    expect(changed.status).toBe(200);
    expect(changed.body.settings.artifact).toBe("board-from-api");
    expect(readFileSync(instance.manifestPath, "utf8")).toBe(source);

    const reset = await app.resetSettings();
    expect(reset.status).toBe(200);
    expect(reset.body.settings.artifact).toBe("board-2f9c81ae");
    expect(readFileSync(instance.manifestPath, "utf8")).toBe(source);
  });

  it("should have built an artifact and deployed nothing at all", async () => {
    // Build and deploy are two facts. This is the one the story is built on.
    const registry = await app.get("/shipyard/artifacts");
    expect(registry.status).toBe(200);
    expect(registry.body.artifacts).toHaveLength(1);
    expect(registry.body.artifacts[0].id).toMatch(/^board-[0-9a-f]{12}$/);
    artifactId = registry.body.artifacts[0].id as string;

    const releases = await app.get("/shipyard/releases");
    expect(releases.body.live).toBeNull();
    expect(releases.body.generation).toBe(0);
    // The predecessor's abandoned attempt, present from boot, so "exactly one
    // release" is unreachable without a deliberate delete on every path.
    expect(releases.body.releases).toHaveLength(1);
    expect(releases.body.releases[0]).toMatchObject({ id: "rel-0", state: "failed" });

    const site = await app.site();
    expect(site.status).toBe(503);
    expect(site.body.error).toBe("no_live_release");
    expect(site.body.publicSerial).toBeUndefined();
  });

  it("should start with every gate false, no receipts, and no sign-off", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      site_serving: false,
      survives_key_rotation: false,
      single_release: false,
    });
    expect(state.tokens).toEqual({
      site_serving: null,
      survives_key_rotation: null,
      single_release: null,
    });
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should refuse the shipped manifest at resolve-artifact, and say so", async () => {
    const refused = await app.deploy();
    expect(refused.status).toBe(422);
    expect(refused.body.release.failure).toMatchObject({
      stage: "resolve-artifact",
      reason: "unknown_artifact",
    });
    expect(refused.body.release.failure.detail).toContain(STALE_ARTIFACT);
    expect(refused.body.transcript.map((step: { status: string }) => step.status)).toEqual([
      "ok",
      "failed",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);

    const logs = await app.get("/api/logs?limit=200");
    expect(
      logs.body.lines.some((line: { message: string }) =>
        line.message.includes("stage=resolve-artifact status=failed"),
      ),
    ).toBe(true);
  });

  it("should refuse next at resolve-config, naming the setting it needs", async () => {
    app.writeManifest({ artifact: artifactId });
    const refused = await app.deploy();
    expect(refused.status).toBe(422);
    expect(refused.body.release.failure).toMatchObject({
      stage: "resolve-config",
      reason: "missing_required_env",
    });
    expect(refused.body.release.failure.detail).toContain("BOARD_SIGNING_KEY");
  });

  it("should never answer a refused deploy with a 5xx", async () => {
    // A release that is wrong is not the platform breaking. Answering 500 would
    // send the participant looking at the wrong thing.
    const refused = await app.deploy();
    expect(refused.status).toBeLessThan(500);
  });

  it("should credit built-artifact only for the id the registry holds", async () => {
    expect((await app.answer("built-artifact", artifactId)).body.correct).toBe(true);
    expect((await app.answer("built-artifact", ` ${artifactId} `)).body.correct).toBe(true);
    // The one id that IS committed to this repository is the predecessor's.
    expect((await app.answer("built-artifact", STALE_ARTIFACT)).body.correct).toBe(false);
    expect((await app.answer("built-artifact", "board-000000000000")).body.correct).toBe(false);
  });

  it("should refuse the receipt checkpoint while no promote has ever run", async () => {
    // There is no preimage to guess: the value does not exist yet.
    expect((await app.answer("release-receipt", "000000000000")).body.correct).toBe(false);
    expect((await app.answer("release-receipt", "")).body.correct).toBe(false);
  });

  it("should not put a receipt on a release the pipeline refused", async () => {
    // Submitting a guess only proves guessing does not work. What makes this
    // checkpoint mean something is that a receipt exists *because* a promote
    // completed — and nothing above pins that. A one-line regression that
    // stamped a receipt onto the failure path would award 40 points for a
    // refused deploy, and every assertion in this file would stay green.
    const listed = (await app.get("/shipyard/releases")).body as {
      releases: Array<{ id: string; state: string; receipt: string | null }>;
    };
    expect(listed.releases.length).toBeGreaterThan(0);
    for (const release of listed.releases) {
      if (release.state !== "live" && release.state !== "superseded") {
        expect(release.receipt).toBeNull();
      }
    }
  });

  it("should refuse every receipt the plane is actually exposing, until one is earned", async () => {
    // Harvested from the app rather than invented, so this cannot go stale: any
    // receipt a participant could read off the release plane right now must be
    // refused while no promote has completed.
    const listed = (await app.get("/shipyard/releases")).body as {
      releases: Array<{ id: string; state: string; receipt: string | null }>;
    };
    const exposed = listed.releases
      .map((release) => release.receipt)
      .filter((receipt): receipt is string => typeof receipt === "string" && receipt !== "");
    for (const receipt of exposed) {
      expect((await app.answer("release-receipt", receipt)).body.correct).toBe(false);
    }
  });

  it("should promote a release once the manifest carries what the app needs", async () => {
    // A pasted copy of the key: the shortcut a participant can actually take,
    // and it genuinely works right now. That is the whole point of it.
    const value = await app.secretValue();
    app.writeManifest({ env: { BOARD_SIGNING_KEY: value } });
    const promoted = await app.deploy();
    expect(promoted.status).toBe(201);
    expect(promoted.body.transcript.every((step: { status: string }) => step.status === "ok")).toBe(
      true,
    );
    expect(promoted.body.release).toMatchObject({
      state: "live",
      artifact: artifactId,
      generation: 1,
      keyBinding: "literal",
      title: LAPTOP_TITLE,
    });
    expect(promoted.body.release.receipt).toMatch(/^[0-9a-f]{12}$/);

    const logs = await app.get("/api/logs?limit=200");
    const promoteLine = logs.body.lines.find((line: { message: string }) =>
      line.message.includes("stage=promote status=ok"),
    );
    expect(promoteLine.message).toContain(`receipt=${promoted.body.release.receipt}`);
  });

  it("should credit the receipt from the promote line", async () => {
    const releases = await app.get("/shipyard/releases");
    const live = releases.body.releases.find((entry: { state: string }) => entry.state === "live");
    expect((await app.answer("release-receipt", live.receipt)).body.correct).toBe(true);
    expect((await app.answer("release-receipt", `${live.receipt}0`)).body.correct).toBe(false);
  });

  it("should answer from the published entrance, with a serial the board never prints", async () => {
    const site = await app.site();
    expect(site.status).toBe(200);
    expect(site.body.publicSerial).toMatch(/^SSX-[0-9a-f]{8}$/);
    publicSerial = site.body.publicSerial as string;

    const board = await app.get("/api/board");
    expect(board.body.serial).toMatch(/^SS-[0-9a-f]{8}$/);
    expect(board.body.serial).not.toBe(publicSerial);
    // The public serial appears on the published surface and nowhere else.
    for (const path of ["/", "/api/board", "/api/logs?limit=500", "/posture", "/shipyard", "/shipyard/state", "/shipyard/releases"]) {
      expect((await app.get(path)).text).not.toContain(publicSerial);
    }
  });

  it("should raise site_serving only once the site has actually been asked", async () => {
    // A pure predicate over plane state would already be true here: a live
    // release exists and its key resolves. The gate wants the stronger fact.
    const before = await app.posture();
    expect(before.gates.site_serving).toBe(true); // the probe above was a real request
    // ...and it goes back to false when a new generation has not been asked for.
    app.writeManifest({ env: { BOARD_PUBLIC_TITLE: chosenTitle } });
    expect((await app.deploy()).status).toBe(201);
    const afterDeploy = await app.posture();
    expect(afterDeploy.gates.site_serving).toBe(false);
    expect((await app.site()).status).toBe(200);
    expect((await app.posture()).gates.site_serving).toBe(true);
  });

  it("should refuse the published title while the release still carries the shipped one", async () => {
    expect((await app.answer("published-title", LAPTOP_TITLE)).body.correct).toBe(false);
    const config = JSON.parse(readFileSync(instance.configPath, "utf8")) as { boardTitle: string };
    // The board's own config decides the board's title, not the outside's.
    expect((await app.answer("published-title", config.boardTitle)).body.correct).toBe(false);
  });

  it("should credit the published title the live release actually carried", async () => {
    const site = await app.site();
    expect(site.body.title).toBe(chosenTitle);
    expect((await app.answer("published-title", chosenTitle)).body.correct).toBe(true);
    expect((await app.answer("published-title", `${chosenTitle} `)).body.correct).toBe(true);
    expect((await app.answer("published-title", chosenTitle.slice(0, -1))).body.correct).toBe(false);
  });

  it("should keep every link on both pages relative, so a forwarded origin works", async () => {
    for (const path of ["/shipyard", "/site"]) {
      const page = await app.get(path);
      expect(page.text).not.toContain("http://127.0.0.1");
      expect(page.text).not.toContain("http://localhost");
      expect(page.text).not.toMatch(/href="\//);
    }
  });

  it("should escape a title the participant chose before putting it on the page", async () => {
    const page = await app.get("/site");
    expect(page.status).toBe(200);
    expect(page.text).toContain("&lt;公開&gt;");
    expect(page.text).not.toContain("<公開>");
  });

  it("should hold survives_key_rotation false for a release that pasted the key", async () => {
    const state = await app.posture();
    expect(state.gates.survives_key_rotation).toBe(false);
    expect(state.tokens.survives_key_rotation).toBeNull();
    expect(state.readyToken).toBeNull();
    // No token exists, so nothing can be submitted for it.
    expect((await app.answer("rotation-survives", "TC{survives_key_rotation_0}")).body.correct).toBe(
      false,
    );
  });

  it("should drop the entrance at the next rotation, and name the release that broke", async () => {
    const rotated = await app.post("/shipyard/secrets/rotate");
    expect(rotated.status).toBe(200);
    expect(rotated.body.version).toBe(2);

    const site = await app.site();
    expect(site.status).toBe(503);
    expect(site.body.error).toBe("signature_rejected");
    expect(site.body.releaseId).toBe((await app.get("/shipyard/releases")).body.live);

    // ...and the checkpoint that passed a moment ago stops passing, because it
    // re-probes rather than remembering.
    expect((await app.answer("published-title", chosenTitle)).body.correct).toBe(false);
  });

  it("should keep a reference-bound release healthy across a rotation, without redeploying", async () => {
    app.writeManifest({ env: { BOARD_SIGNING_KEY: { fromSecret: "board-signing-key" } } });
    const promoted = await app.deploy();
    expect(promoted.status).toBe(201);
    expect(promoted.body.release.keyBinding).toBe("reference");

    const before = await app.site();
    expect(before.status).toBe(200);
    const generation = before.body.generation as number;

    expect((await app.post("/shipyard/secrets/rotate")).body.version).toBe(3);
    const after = await app.site();
    expect(after.status).toBe(200);
    // No implicit redeploy happened: the same release re-resolved its key.
    expect(after.body.generation).toBe(generation);
    expect(after.body.releaseId).toBe(before.body.releaseId);
    expect(after.body.keyVersion).toBe(3);
  });

  it("should credit rotation-survives for the receipt of the gate that measures it", async () => {
    const state = await app.posture();
    expect(state.gates.survives_key_rotation).toBe(true);
    const token = state.tokens.survives_key_rotation as string;
    expect(token).toMatch(/^TC\{survives_key_rotation_[0-9a-f]{16}\}$/);
    expect((await app.answer("rotation-survives", token)).body.correct).toBe(true);
    expect((await app.answer("rotation-survives", token.slice(0, -1))).body.correct).toBe(false);
  });

  it("should not move the secret store while scoring, however many times it is asked", async () => {
    // A wrong answer that rotated would punish a participant for being scored,
    // and a retried verdict would rotate twice.
    const before = (await app.get("/shipyard/state")).body.secret.version;
    const token = (await app.posture()).tokens.survives_key_rotation as string;
    for (const submission of ["", "nonsense", token, token, token]) {
      await app.answer("rotation-survives", submission);
    }
    expect((await app.get("/shipyard/state")).body.secret.version).toBe(before);
    expect((await app.site()).status).toBe(200);
  });

  it("should withhold the sign-off while the failed attempts are still lying around", async () => {
    const releases = await app.get("/shipyard/releases");
    expect(releases.body.releases.length).toBeGreaterThan(1);
    const state = await app.posture();
    expect(state.gates.single_release).toBe(false);
    expect(state.readyToken).toBeNull();
    expect((await app.answer("clean-cutover", "TC{ready_0000000000000000}")).body.correct).toBe(
      false,
    );
  });

  it("should emit the sign-off once one live release is left and the site has answered", async () => {
    const releases = await app.get("/shipyard/releases");
    const live = releases.body.live as string;
    for (const entry of releases.body.releases as Array<{ id: string }>) {
      if (entry.id === live) continue;
      expect((await app.remove(`/shipyard/release?id=${entry.id}`)).status).toBe(200);
    }
    expect((await app.site()).status).toBe(200);

    const state = await app.posture();
    expect(state.gates).toEqual({
      site_serving: true,
      survives_key_rotation: true,
      single_release: true,
    });
    expect(state.ready).toBe(true);
    expect(state.readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
    expect((await app.answer("clean-cutover", state.readyToken as string)).body.correct).toBe(true);
  });

  it("should reject an empty, truncated or extended submission on every checkpoint", async () => {
    // Guards against a handler loosened to a substring or truthiness test.
    const posture = await app.posture();
    const releases = await app.get("/shipyard/releases");
    const live = releases.body.releases.find((entry: { state: string }) => entry.state === "live");
    const answers: Record<string, string> = {
      "built-artifact": artifactId,
      "release-receipt": live.receipt as string,
      "published-title": chosenTitle,
      "rotation-survives": posture.tokens.survives_key_rotation as string,
      "clean-cutover": posture.readyToken as string,
    };
    for (const check of metadata.scoring.checks) {
      const right = answers[check.id] as string;
      expect(right).toBeTruthy();
      expect((await app.answer(check.id, "")).body.correct).toBe(false);
      expect((await app.answer(check.id, "   ")).body.correct).toBe(false);
      expect((await app.answer(check.id, right.slice(0, -1))).body.correct).toBe(false);
      expect((await app.answer(check.id, `${right}x`)).body.correct).toBe(false);
      // ...and the true answer still passes, so the four assertions above are
      // not passing merely because the checkpoint rejects everything.
      expect((await app.answer(check.id, right)).body.correct).toBe(true);
    }
  });

  it("should stop accepting a sign-off captured while green once the site is down again", async () => {
    const token = (await app.posture()).readyToken as string;
    const live = (await app.get("/shipyard/releases")).body.live as string;
    // Deleting what is serving is permitted: the plane shows the outage rather
    // than deciding for the participant.
    const removed = await app.remove(`/shipyard/release?id=${live}`);
    expect(removed.status).toBe(200);
    expect(removed.body.live).toBeNull();

    expect((await app.site()).status).toBe(503);
    const logs = await app.get("/api/logs?limit=200");
    expect(
      logs.body.lines.some((line: { message: string }) => line.message.startsWith("site down:")),
    ).toBe(true);

    // Zero releases: the tidiness condition is trivially "nothing left", and it
    // still fails, because the entrance is down.
    const state = await app.posture();
    expect(state.gates.single_release).toBe(false);
    expect(state.readyToken).toBeNull();
    expect((await app.answer("clean-cutover", token)).body.correct).toBe(false);
    expect((await app.answer("rotation-survives", "anything")).body.correct).toBe(false);
    expect((await app.answer("published-title", chosenTitle)).body.correct).toBe(false);
  });

  it("should recover from a self-inflicted outage with one redeploy", async () => {
    expect((await app.deploy()).status).toBe(201);
    expect((await app.site()).status).toBe(200);
    const state = await app.posture();
    expect(state.ready).toBe(true);
    expect((await app.answer("clean-cutover", state.readyToken as string)).body.correct).toBe(true);
  });

  it("should never serve a signing key value except on the route that exists to read it", async () => {
    const value = await app.secretValue();
    expect(value).toMatch(/^[0-9a-f]{32}$/);
    for (const path of [
      "/",
      "/api/board",
      "/api/logs?limit=500",
      "/posture",
      "/healthz",
      "/shipyard",
      "/shipyard/state",
      "/shipyard/releases",
      "/shipyard/artifacts",
      "/shipyard/secrets",
      "/site",
      "/site/healthz",
    ]) {
      expect((await app.get(path)).text).not.toContain(value);
    }
    // Reading it is logged, because in a real store it would be.
    const logs = await app.get("/api/logs?limit=200");
    expect(
      logs.body.lines.some((line: { message: string }) =>
        line.message.startsWith("secret value read name=board-signing-key"),
      ),
    ).toBe(true);
  });

  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await app.answer(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    const source = readFileSync(SCENARIO_FILE, "utf8");
    const block = source.slice(source.indexOf("export const checks = {"));
    const handlers = [...block.matchAll(/^ {2}"([a-z][a-z0-9-]*)":/gm)].map((m) => m[1] as string);
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

  it("should 404 an unknown release id rather than guessing", async () => {
    expect((await app.get("/shipyard/release?id=rel-999")).status).toBe(404);
    expect((await app.remove("/shipyard/release?id=rel-999")).status).toBe(404);
    expect((await app.get("/shipyard/release")).status).toBe(404);
  });

  it("should not expose a write path on the published entrance", async () => {
    const response = await fetch(`${instance.board}/site`, { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("should survive a request target it cannot even parse", async () => {
    // Both servers share one process: an unhandled throw here would end the
    // participant's session over a typo.
    await new Promise<void>((resolve) => {
      const socket = connect(18310, "127.0.0.1", () => {
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
    expect((await app.site()).status).toBe(200);
    expect((await fetch("http://127.0.0.1:18311/healthz")).ok).toBe(true);
  });

  it("should stay well throughout: no uncaught fault was taken", async () => {
    const health = await app.get("/healthz");
    expect(health.status).toBe(200);
    expect(health.body.faults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-ship gates on a fresh instance", () => {
  /**
   * Every gate asserted in its FALSE state, then raised one at a time. The pass
   * above only ever ends with them green, so a gate hardcoded to `true` —
   * `survives_key_rotation: () => true` is the dangerous one, since it would
   * hand the sign-off to a release that pasted its key — would survive it.
   *
   * The three gates are deliberately independent: each is raised here while at
   * least one other is still false, which is only possible because none of them
   * implies another.
   */
  let instance: Instance;
  const app = client(() => instance);

  beforeAll(async () => {
    instance = await startInstance("gates", 18312, 18313);
  });
  afterAll(() => instance?.kill());

  it("should change the manifest through the API, refuse a bad value, and reset to the mount", async () => {
    // The participant loop of #378: the mounted file is the starting point, a
    // change rides on top of it inside the container, and discarding the change
    // — or rebuilding the container — brings the broken start back.
    const fileBefore = readFileSync(instance.manifestPath, "utf8");

    const refused = await app.settings.patch({ artifact: "" });
    expect(refused.status).toBe(400);

    const changed = await app.settings.patch({ artifact: "board-but-newer" });
    expect(changed.status).toBe(200);
    expect((await app.settings.get()).body.settings.artifact).toBe("board-but-newer");
    expect(readFileSync(instance.manifestPath, "utf8")).toBe(fileBefore);

    const reset = await app.settings.discard();
    expect(reset.status).toBe(200);
    expect((await app.settings.get()).body.settings.artifact).toBe("board-2f9c81ae");
  });

  it("should start with every gate false and no sign-off token", async () => {
    const state = await app.posture();
    expect(state.gates).toEqual({
      site_serving: false,
      survives_key_rotation: false,
      single_release: false,
    });
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should fail every checkpoint on an untouched starter", async () => {
    // The whole-problem version of "no vacuous pass": before anything is done,
    // there is no submission that earns anything. The two checkpoints that are
    // partly about an absence (a release that survives rotation, a plane with
    // nothing left over) fail here because their correctness preconditions —
    // an entrance that answers 200 — are not met.
    const config = JSON.parse(readFileSync(instance.configPath, "utf8")) as { boardTitle: string };
    const plausible: Record<string, string[]> = {
      "built-artifact": [STALE_ARTIFACT, "board-000000000000"],
      "release-receipt": ["000000000000", "deadbeefcafe"],
      "published-title": [LAPTOP_TITLE, config.boardTitle, "anything"],
      "rotation-survives": ["TC{survives_key_rotation_0000000000000000}"],
      "clean-cutover": ["TC{ready_0000000000000000}"],
    };
    for (const check of metadata.scoring.checks) {
      for (const submission of plausible[check.id] as string[]) {
        expect((await app.answer(check.id, submission)).body.correct).toBe(false);
      }
    }
  });

  it("should stay false while the only record left is a dead one", async () => {
    // Tidiness alone buys nothing: exactly one record is in the plane already,
    // and counting to one is not what the gate means.
    expect((await app.get("/shipyard/releases")).body.releases).toHaveLength(1);
    expect((await app.posture()).gates.single_release).toBe(false);
  });

  it("should raise single_release on its own, with nothing else green", async () => {
    expect((await app.remove("/shipyard/release?id=rel-0")).status).toBe(200);
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    app.writeManifest({ artifact, env: { BOARD_SIGNING_KEY: await app.secretValue() } });
    expect((await app.deploy()).status).toBe(201);

    const state = await app.posture();
    expect(state.gates.single_release).toBe(true);
    expect(state.gates.site_serving).toBe(false);
    expect(state.gates.survives_key_rotation).toBe(false);
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should raise site_serving on its own, while the key is still a pasted copy", async () => {
    expect((await app.site()).status).toBe(200);
    const state = await app.posture();
    expect(state.gates.site_serving).toBe(true);
    expect(state.gates.survives_key_rotation).toBe(false);
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
    expect(state.tokens.survives_key_rotation).toBeNull();
  });

  it("should raise survives_key_rotation only for a release that resolves by reference", async () => {
    app.writeManifest({ env: { BOARD_SIGNING_KEY: { fromSecret: "board-signing-key" } } });
    expect((await app.deploy()).status).toBe(201);
    // Two records again, and the new generation has not been asked for yet.
    const partial = await app.posture();
    expect(partial.gates.survives_key_rotation).toBe(true);
    expect(partial.gates.site_serving).toBe(false);
    expect(partial.gates.single_release).toBe(false);
    expect(partial.ready).toBe(false);
    expect(partial.readyToken).toBeNull();
  });

  it("should hand out the sign-off only when the last of the three turns", async () => {
    const releases = await app.get("/shipyard/releases");
    const live = releases.body.live as string;
    for (const entry of releases.body.releases as Array<{ id: string }>) {
      if (entry.id !== live) expect((await app.remove(`/shipyard/release?id=${entry.id}`)).status).toBe(200);
    }
    const stillWaiting = await app.posture();
    expect(stillWaiting.gates.single_release).toBe(true);
    expect(stillWaiting.gates.site_serving).toBe(false);
    expect(stillWaiting.readyToken).toBeNull();

    expect((await app.site()).status).toBe(200);
    const done = await app.posture();
    expect(done.ready).toBe(true);
    expect(done.readyToken).not.toBeNull();
  });

  it("should not raise a gate for a route it 404s", async () => {
    const before = await app.posture();
    await app.get("/shipyard/not-really");
    expect((await app.posture()).gates).toEqual(before.gates);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-ship manifest hygiene", () => {
  let instance: Instance;
  const app = client(() => instance);

  beforeAll(async () => {
    instance = await startInstance("manifest", 18314, 18315);
  });
  afterAll(() => instance?.kill());

  const cases: ReadonlyArray<[string, string, string, string]> = [
    ["malformed JSON", "{ this is not json", "read-manifest", "manifest_invalid"],
    ["a JSON array", "[]", "read-manifest", "manifest_invalid"],
    ["a missing artifact field", JSON.stringify({ env: {} }), "read-manifest", "manifest_invalid"],
    [
      "a field the plane does not read",
      JSON.stringify({ artifact: "x", env: {}, healthPath: "/always-ok" }),
      "read-manifest",
      "manifest_invalid",
    ],
    [
      "env that is not an object",
      JSON.stringify({ artifact: "x", env: "BOARD_SIGNING_KEY=..." }),
      "read-manifest",
      "manifest_invalid",
    ],
  ];

  it.each(cases)("should name %s rather than defaulting past it", async (_name, text, stage, reason) => {
    app.writeManifestRaw(text);
    const refused = await app.deploy();
    expect(refused.status).toBe(422);
    expect(refused.body.release.failure).toMatchObject({ stage, reason });
    // ...and it is still answering afterwards.
    expect((await app.get("/healthz")).status).toBe(200);
  });

  it("should refuse an env key it does not read, rather than ignoring it", async () => {
    // A manifest that silently drops half of what it declares is how a deploy
    // "succeeds" and serves the wrong thing. There is no health-gate knob here
    // for a participant to relax, and an unknown one is refused loudly.
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    app.writeManifestRaw(
      JSON.stringify({
        artifact,
        env: { BOARD_PUBLIC_TITLE: "t", BOARD_SIGNING_KEY: "k", HEALTH_PATH: "/always-ok" },
      }),
    );
    const refused = await app.deploy();
    expect(refused.body.release.failure).toMatchObject({
      stage: "resolve-config",
      reason: "unknown_env_key",
    });
    expect(refused.body.release.failure.detail).toContain("HEALTH_PATH");
  });

  it("should refuse a title that is empty or the wrong type", async () => {
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    for (const title of ["", "   ", 7, null]) {
      app.writeManifestRaw(
        JSON.stringify({ artifact, env: { BOARD_PUBLIC_TITLE: title, BOARD_SIGNING_KEY: "k" } }),
      );
      const refused = await app.deploy();
      expect(refused.body.release.failure.stage).toBe("resolve-config");
      expect(refused.body.release.failure.detail).toContain("BOARD_PUBLIC_TITLE");
    }
  });

  it("should refuse a reference to a secret the store does not hold", async () => {
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    app.writeManifestRaw(
      JSON.stringify({
        artifact,
        env: { BOARD_PUBLIC_TITLE: "t", BOARD_SIGNING_KEY: { fromSecret: "no-such-secret" } },
      }),
    );
    const refused = await app.deploy();
    expect(refused.body.release.failure).toMatchObject({
      stage: "resolve-config",
      reason: "unknown_secret",
    });
  });

  it("should refuse a key that cannot sign anything this platform accepts", async () => {
    // A typo'd or stale copy fails at the health gate, before anything is
    // promoted — the previous live release, if any, keeps serving.
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    app.writeManifestRaw(
      JSON.stringify({ artifact, env: { BOARD_PUBLIC_TITLE: "t", BOARD_SIGNING_KEY: "not-the-key" } }),
    );
    const refused = await app.deploy();
    expect(refused.body.release.failure).toMatchObject({
      stage: "health-gate",
      reason: "signature_rejected",
    });
    expect((await app.get("/shipyard/releases")).body.live).toBeNull();
  });

  it("should not reward rotating first and then pasting the fresh value", async () => {
    // The rotation question is asked against the epoch after this one, so a
    // freshly copied literal is already a version behind before it is written.
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    expect((await app.post("/shipyard/secrets/rotate")).body.version).toBe(2);
    const fresh = await app.secretValue();
    app.writeManifestRaw(
      JSON.stringify({ artifact, env: { BOARD_PUBLIC_TITLE: "fresh copy", BOARD_SIGNING_KEY: fresh } }),
    );
    expect((await app.deploy()).status).toBe(201);
    expect((await app.site()).status).toBe(200);

    const state = await app.posture();
    expect(state.gates.site_serving).toBe(true);
    expect(state.gates.survives_key_rotation).toBe(false);
    expect(state.readyToken).toBeNull();
    expect((await app.answer("published-title", "fresh copy")).body.correct).toBe(true);
    expect((await app.answer("rotation-survives", "TC{survives_key_rotation_x}")).body.correct).toBe(
      false,
    );
  });

  it("should not reward deleting everything to satisfy the tidiness condition", async () => {
    const releases = await app.get("/shipyard/releases");
    for (const entry of releases.body.releases as Array<{ id: string }>) {
      await app.remove(`/shipyard/release?id=${entry.id}`);
    }
    expect((await app.get("/shipyard/releases")).body.releases).toHaveLength(0);
    const state = await app.posture();
    // Zero is not one, and the entrance is down either way.
    expect(state.gates.single_release).toBe(false);
    expect(state.gates.site_serving).toBe(false);
    expect(state.readyToken).toBeNull();
    expect((await app.site()).status).toBe(503);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-ship probes are real, and cost the participant nothing", () => {
  let instance: Instance;
  const app = client(() => instance);

  beforeAll(async () => {
    instance = await startInstance("probe", 18316, 18317);
  });
  afterAll(() => instance?.kill());

  it("should probe the entrance on the port the app was told to listen on", async () => {
    // Deliberately not the default 8080. A checkpoint that probed a constant
    // port would return false for every submission, including the true one,
    // and would only be discovered by a participant.
    const artifact = (await app.get("/shipyard/artifacts")).body.artifacts[0].id as string;
    app.writeManifest({
      artifact,
      env: { BOARD_PUBLIC_TITLE: "on another port", BOARD_SIGNING_KEY: { fromSecret: "board-signing-key" } },
    });
    expect((await app.deploy()).status).toBe(201);
    expect((await app.answer("published-title", "on another port")).body.correct).toBe(true);
  });

  it("should not raise the participant's site_serving gate by being scored", async () => {
    // Nothing but the scorer has asked the entrance on this instance. The
    // checkpoint above passed on a real 200, and the gate still has to be
    // earned by the participant asking for themselves.
    expect((await app.posture()).gates.site_serving).toBe(false);
    expect((await app.answer("rotation-survives", "wrong")).body.correct).toBe(false);
    expect((await app.posture()).gates.site_serving).toBe(false);
    expect((await app.site()).status).toBe(200);
    expect((await app.posture()).gates.site_serving).toBe(true);
  });

  it("should refuse the cutover while the plane still holds the abandoned attempt", async () => {
    const state = await app.posture();
    expect(state.gates.site_serving).toBe(true);
    expect(state.gates.survives_key_rotation).toBe(true);
    expect(state.gates.single_release).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should answer a checkpoint the same way twice, with no side effect in between", async () => {
    const before = (await app.get("/shipyard/state")).body;
    const token = (await app.posture()).tokens.survives_key_rotation as string;
    expect((await app.answer("rotation-survives", token)).body.correct).toBe(true);
    expect((await app.answer("rotation-survives", token)).body.correct).toBe(true);
    const after = (await app.get("/shipyard/state")).body;
    expect(after.secret).toEqual(before.secret);
    expect(after.generation).toBe(before.generation);
    expect(after.live).toBe(before.live);
    expect(after.releaseCount).toBe(before.releaseCount);
  });

  it("should keep a receipt from a superseded release valid", async () => {
    // The expected play is several deploys, and hints send the participant back
    // to redeploy. A participant who reads the right value off an earlier
    // promote line has still done the thing being measured.
    const first = (await app.get("/shipyard/releases")).body.releases.find(
      (entry: { state: string }) => entry.state === "live",
    );
    app.writeManifest({ env: { BOARD_PUBLIC_TITLE: "second cut" } });
    expect((await app.deploy()).status).toBe(201);
    const second = (await app.get("/shipyard/releases")).body.releases.find(
      (entry: { state: string }) => entry.state === "live",
    );
    expect(second.receipt).not.toBe(first.receipt);
    expect((await app.answer("release-receipt", first.receipt)).body.correct).toBe(true);
    expect((await app.answer("release-receipt", second.receipt)).body.correct).toBe(true);
  });

  it("should keep the boot lines reachable however much later traffic arrives", async () => {
    // Six transcript lines per deploy attempt drive the ring far faster than
    // onboarding's traffic does.
    for (let attempt = 0; attempt < 200; attempt += 1) await app.get(`/nope-${attempt}`);
    const logs = await app.get("/api/logs");
    expect(
      logs.body.lines.some((line: { message: string }) => line.message.startsWith("boot ok")),
    ).toBe(true);
  });

  it("should serve the outside a heading the board's own config cannot change", async () => {
    // The board's config decides the board's title. A deploy is what carries a
    // setting to the outside, which is the distinction this problem exists for —
    // so editing `config/app.json` cannot fake the published heading.
    app.writeManifest({ env: { BOARD_PUBLIC_TITLE: "from the release" } });
    expect((await app.deploy()).status).toBe(201);
    writeFileSync(
      instance.configPath,
      JSON.stringify({ boardTitle: "from the config file", acceptingPosts: true }),
    );
    expect((await app.get("/api/board")).body.title).toBe("from the config file");
    expect((await app.site()).body.title).toBe("from the release");
    expect((await app.answer("published-title", "from the config file")).body.correct).toBe(false);
    expect((await app.answer("published-title", "from the release")).body.correct).toBe(true);
  });

  it("should answer an oversize body rather than resetting the socket", async () => {
    const response = await fetch(`${instance.board}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "a", title: "b", body: "x".repeat(70 * 1024) }),
    });
    expect(response.status).toBe(413);
  });
});

// ---------------------------------------------------------------------------

describe("stackstack-ship wiring", () => {
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
    expect(service.environment.SCENARIO).toBe("ship");
    expect(existsSync(join(composeDir, service.build.context, "app", "scenarios", "ship.mjs"))).toBe(
      true,
    );
  });

  it("should mount both participant-owned directories read-only", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro", "./release:/app/release:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
    expect(existsSync(join(composeDir, "release", "release.json"))).toBe(true);
  });

  it("should carry no path hint for anyone to resurrect in copy (#378)", () => {
    // The participant changes the manifest through PATCH /api/settings, so the
    // compose file must not ship a "path to open" for a doc or a page to quote.
    expect(service.environment.RELEASE_HINT).toBeUndefined();
    expect(service.environment.CONFIG_HINT).toBeUndefined();
    for (const inThisRepo of [
      "challenges/stackstack-ship/local/release/release.json",
      "challenges/stackstack-ship/local/config/app.json",
    ]) {
      expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
    }
  });

  it("should steer every participant-facing doc to the API, never to the checkout file", () => {
    for (const name of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = readFileSync(join(PROBLEM_DIR, name), "utf8");
      expect(text).not.toContain("challenges/stackstack-ship/local/");
      expect(text).toContain("/api/settings");
    }
  });

  it("should ship a manifest that cannot deploy, in exactly the two documented ways", () => {
    const manifest = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "release", "release.json"), "utf8"),
    ) as { artifact: string; env: Record<string, unknown> };
    // 8 hex where the generated one is 12: structurally incapable of matching,
    // so no seed can ever make the committed value the right answer.
    expect(manifest.artifact).toBe(STALE_ARTIFACT);
    expect(manifest.artifact).toMatch(/^board-[0-9a-f]{8}$/);
    expect(manifest.env.BOARD_SIGNING_KEY).toBeUndefined();
    expect(manifest.env.BOARD_PUBLIC_TITLE).toBe(LAPTOP_TITLE);
  });

  it("should keep the shipped title and the value the checkpoint refuses in step", () => {
    // `published-title` refuses this exact string. If the manifest and the
    // scenario drifted apart, the checkpoint would credit a release nobody
    // touched.
    expect(readFileSync(SCENARIO_FILE, "utf8")).toContain(`"${LAPTOP_TITLE}"`);
  });

  it("should keep the two READMEs materially equivalent", () => {
    // AGENT.md §1a: equivalent in story, deployment model, play flow, scoring
    // and cost. Checked on the load-bearing facts rather than by translation.
    const english = readFileSync(join(PROBLEM_DIR, "README.md"), "utf8");
    const japanese = readFileSync(join(PROBLEM_DIR, "README.ja.md"), "utf8");
    for (const anchor of [
      "POST /shipyard/releases",
      "DELETE /shipyard/release?id=rel-1",
      "GET /shipyard/secrets/value?name=…",
      "GET /site/healthz",
      "127.0.0.1:18080/site",
      "127.0.0.1:18081",
      "PATCH /api/settings",
      "make local PROBLEM=stackstack-ship",
      "DELETE /api/settings",
      "8 / 16 / 16 / 28 / 16",
    ]) {
      expect(english).toContain(anchor);
      expect(japanese).toContain(anchor);
    }
    for (const points of metadata.scoring.checks.map((check) => String(check.points))) {
      expect(english).toContain(points);
      expect(japanese).toContain(points);
    }
  });

  it("should ship a board config this problem is not about", () => {
    const config = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    expect(config.acceptingPosts).toBe(true);
  });
});
