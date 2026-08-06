import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-onboarding is the 15-minute environment check that runs before
 * StackStack proper, so the thing that must never break is the *loop itself*:
 * reach the app, read its log, change one setting, write through it, get scored.
 *
 * These tests drive the real app over real HTTP rather than asserting on its
 * source text. The base app deliberately depends on nothing outside `node:http`
 * and `node:crypto` precisely so it runs under Bun here and under Node 22 in the
 * container — a static check would pass while a participant's first fifteen
 * minutes were broken, which is the one failure this problem cannot afford.
 *
 * The config file is copied to a scratch directory first: these tests edit it
 * the way a participant does, and must not leave the repository's shipped
 * config flipped.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-onboarding");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");

// Ports well clear of the catalog's 18080/18081 convention, so a running
// `make local` session does not collide with the suite.
const CHALLENGE_PORT = 18190;
const VERIFY_PORT = 18191;
const BOARD = `http://127.0.0.1:${CHALLENGE_PORT}`;
const VERIFY = `http://127.0.0.1:${VERIFY_PORT}/verify`;
const SEED = "stackstack-onboarding-test-seed";
// The value the shipped compose file sets, so the suite exercises what a
// participant is actually shown rather than a convenient stand-in.

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

const metadata = JSON.parse(
  readFileSync(join(PROBLEM_DIR, "metadata.json"), "utf8"),
) as Metadata;

let scratch = "";
let configPath = "";
let server: ReturnType<typeof spawn>;

/** Rewrite the participant-owned config the way an editor save does. */
function writeConfig(patch: Record<string, unknown>): void {
  const current = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  writeFileSync(configPath, JSON.stringify({ ...current, ...patch }, null, 2));
}

async function get(path: string): Promise<{ status: number; body: any; text: string }> {
  const response = await fetch(`${BOARD}${path}`);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

async function post(path: string, payload: unknown) {
  const response = await fetch(`${BOARD}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function verifyCheckpoint(checkpointId: string, submission: string) {
  const response = await fetch(VERIFY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ checkpointId, submission, context: { teamId: "t", problemId: "p" } }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "stackstack-onboarding-"));
  configPath = join(scratch, "app.json");
  writeFileSync(configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));

  server = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "onboarding",
      FLAG_SEED: SEED,
      APP_CONFIG: configPath,
      CHALLENGE_PORT: String(CHALLENGE_PORT),
      VERIFY_PORT: String(VERIFY_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const deadline = Date.now() + 4_000;
  for (;;) {
    try {
      const health = await fetch(`${BOARD}/healthz`);
      if (health.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("the board never became healthy");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(() => {
  server?.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("stackstack-onboarding scoring regulation", () => {
  it("should be an Easy-tier problem worth exactly 100 points", () => {
    expect(metadata.difficulty).toBeLessThanOrEqual(2);
    const total = metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0);
    expect(total).toBe(100);
  });

  it("should keep every hint penalty within the per-checkpoint half", () => {
    for (const check of metadata.scoring.checks) {
      const spent = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(spent).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should keep the whole problem's hint budget under half the total", () => {
    // SCORING.md: opening every hint still leaves at least half the score.
    const spent = metadata.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(spent).toBeLessThanOrEqual(50);
  });

  it("should spend the Easy tier's whole wrong-answer budget and no more", () => {
    // The tier standard is 5% of the base, and the validator only enforces that
    // for flat `points`. Spread across checkpoints it has to still add up to 5.
    const spent = metadata.scoring.checks.reduce(
      (sum, check) => sum + (check.wrongAnswerPenalty ?? 0),
      0,
    );
    expect(spent).toBe(5);
    for (const check of metadata.scoring.checks) {
      expect(check.wrongAnswerPenalty ?? 0).toBeLessThanOrEqual(check.points);
    }
  });

  it("should give every hint in the problem a unique id", () => {
    // The portal's reveal route is keyed on hintId alone, so a duplicate would
    // unlock the wrong hint.
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
});

describe("stackstack-onboarding first lap", () => {
  it("should print the board serial on the page a participant opens", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/board serial: <code>SS-[0-9a-f]{8}<\/code>/);
  });

  it("should keep every board link relative, so a forwarded Codespaces origin works", async () => {
    const page = await get("/");
    expect(page.text).not.toContain("http://127.0.0.1");
    expect(page.text).not.toContain("http://localhost");
  });

  it("should point at the API console and never at a file path", async () => {
    // The old page named a file in the participant's checkout. Editing that file
    // dirtied their git status, and a rebuilt container kept reading the edit —
    // one solve, and that checkout never sees the broken state again. The page
    // now points at the console, and printing ANY file path is the regression.
    const page = await get("/");
    expect(page.text).toContain('href="docs');
    expect(page.text).not.toContain("/app/config/app.json");
    expect(page.text).not.toContain("problems/challenges/");
  });

  it("should provide a browser request workbench for scenario APIs", async () => {
    const docs = await get("/docs");
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('id="request-method"');
    expect(docs.text).toContain('id="request-path"');
    expect(docs.text).toContain('id="request-headers"');
    expect(docs.text).toContain('id="request-body"');
    expect(docs.text).toContain('id="request-send"');
    expect(docs.text).toContain('id="request-response"');
    expect(docs.text).toContain("target.origin !== window.location.origin");
  });

  it("should keep every StackStack instruction and hint browser-solvable", () => {
    const problemIds = [
      "stackstack-onboarding",
      "stackstack-defend",
      "stackstack-observability",
      "stackstack-recover",
      "stackstack-secrets",
      "stackstack-ship",
      "stackstack-safe-exposure",
      "stackstack-vibe-build",
    ];
    for (const problemId of problemIds) {
      const meta = JSON.parse(
        readFileSync(join(REPO_ROOT, "challenges", problemId, "metadata.json"), "utf8"),
      ) as {
        instructions: string;
        scoring: { checks: unknown[] };
        i18n: { en: { instructions: string; checks: unknown[] } };
      };
      const visible = JSON.stringify([
        meta.instructions,
        meta.scoring.checks,
        meta.i18n.en.instructions,
        meta.i18n.en.checks,
      ]).toLowerCase();
      expect(visible).not.toContain("curl");
      expect(visible).not.toContain("docker compose");
      expect(visible).not.toContain("in your checkout");
      expect(visible).not.toContain("チェックアウト側");
    }
  });

  it("should 404 a route it does not serve", async () => {
    const missing = await get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("not_found");
  });

  it("should survive a request target it cannot even parse", async () => {
    // `GET //` is a protocol-relative reference with no host, which `new URL`
    // rejects. Both servers share one process, so an unhandled throw here would
    // take the board and /verify down together and end the session — over a
    // typo. Sent raw, because fetch() would normalise the path away.
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

    expect((await get("/healthz")).status).toBe(200);
    const verifyAlive = await fetch(`http://127.0.0.1:${VERIFY_PORT}/healthz`);
    expect(verifyAlive.ok).toBe(true);
  });

  it("should serve the same serial from the JSON route as from the page", async () => {
    const page = await get("/");
    const board = await get("/api/board");
    expect(page.text).toContain(board.body.serial);
  });

  it("should write the boot-check value into a log line the app itself serves", async () => {
    const logs = await get("/api/logs");
    const boot = logs.body.lines.find((line: { message: string }) =>
      line.message.startsWith("boot ok boot-check="),
    );
    expect(boot).toBeDefined();
    expect(boot.message).toMatch(/^boot ok boot-check=[0-9a-f]{12}$/);
  });

  it("should keep the boot line reachable however much later traffic arrives", async () => {
    // The log ring is bounded, and request traffic drives it. Without the boot
    // lines pinned, a participant who sent a few hundred requests would lose the
    // only place the `log-trail` value appears.
    for (let attempt = 0; attempt < 600; attempt += 1) await get(`/api/nope-${attempt}`);
    const logs = await get("/api/logs");
    expect(
      logs.body.lines.some((line: { message: string }) =>
        line.message.startsWith("boot ok boot-check="),
      ),
    ).toBe(true);
  });

  it("should refuse a post while the board is closed, and say which setting opens it", async () => {
    const rejected = await post("/api/posts", { author: "you", title: "too early", body: "" });
    expect(rejected.status).toBe(409);
    expect(rejected.body.detail).toContain("acceptingPosts");
    // The refusal steers to the API console, never to a file: pointing a
    // participant at the tracked config was how solving used to dirty git.
    expect(rejected.body.detail).toContain("/api/config");
    expect(rejected.body.detail).not.toContain("app.json");
  });

  it("should accept a post as soon as the config file says so, with no restart", async () => {
    writeConfig({ acceptingPosts: true });
    const accepted = await post("/api/posts", {
      author: "newcomer",
      title: "first post",
      body: "hello",
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.post.seeded).toBe(false);
  });

  it("should reject a post that is missing a required field", async () => {
    const rejected = await post("/api/posts", { author: "newcomer", body: "no title" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain("title");
  });

  it("should reject a body larger than the app will read, with an answer rather than a reset", async () => {
    const rejected = await post("/api/posts", {
      author: "newcomer",
      title: "big",
      body: "x".repeat(70 * 1024),
    });
    expect(rejected.status).toBe(413);
  });

  it("should not mistake a body that merely looks like the oversize signal", async () => {
    // The signal is a symbol precisely so a payload cannot impersonate it.
    const rejected = await post("/api/posts", "too-large");
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain("JSON object");
  });

  it("should escape what a participant writes before putting it on the page", async () => {
    // The board renders posts as HTML and the participant controls every field.
    // Unescaped, this is stored XSS in a training app people run on their own
    // machine — and the catalog's own rules forbid shipping one.
    const payload = '<script>alert("xss")</script>';
    const created = await post("/api/posts", {
      author: `a${payload}`,
      title: `t${payload}`,
      body: `b${payload}`,
    });
    expect(created.status).toBe(201);
    const page = await get("/");
    expect(page.text).not.toContain("<script>");
    expect(page.text).toContain("&lt;script&gt;");
  });

  it("should honour the log limit the README documents", async () => {
    // Write past the pinned prologue first: with only the boot lines present,
    // every limit returns the same list and the comparison proves nothing.
    for (let filler = 0; filler < 20; filler += 1) {
      await post("/api/posts", { author: "log", title: `filler ${filler}`, body: "" });
    }
    const narrow = await get("/api/logs?limit=1");
    const wide = await get("/api/logs?limit=200");
    expect(narrow.body.lines.length).toBeLessThan(wide.body.lines.length);
    // The pinned boot lines survive the narrowest possible window.
    expect(
      narrow.body.lines.some((line: { message: string }) =>
        line.message.startsWith("boot ok boot-check="),
      ),
    ).toBe(true);
  });
});

describe("stackstack-onboarding posture", () => {
  it("should turn every gate green once the lap is complete", async () => {
    const posture = await get("/posture");
    expect(posture.body.gates).toEqual({
      board_visited: true,
      logs_read: true,
      posts_open: true,
      post_created: true,
    });
    expect(posture.body.ready).toBe(true);
    expect(posture.body.readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
  });

  it("should drop the gate and withhold the token again if the config is reverted", async () => {
    writeConfig({ acceptingPosts: false });
    const closed = await get("/posture");
    expect(closed.body.gates.posts_open).toBe(false);
    expect(closed.body.ready).toBe(false);
    expect(closed.body.readyToken).toBeNull();
    writeConfig({ acceptingPosts: true });
  });

  it("should report a broken config file rather than quietly using defaults", async () => {
    writeFileSync(configPath, "{ this is not json");
    const health = await get("/healthz");
    expect(health.status).toBe(503);
    expect(health.body.ok).toBe(false);
    expect(health.body.configError).toContain("not valid JSON");

    const logs = await get("/api/logs");
    expect(
      logs.body.lines.some((line: { message: string }) => line.message.startsWith("config error:")),
    ).toBe(true);

    writeFileSync(configPath, JSON.stringify({ boardTitle: "board", acceptingPosts: true }));
    const recovered = await get("/healthz");
    expect(recovered.status).toBe(200);
  });
});

describe("stackstack-onboarding checkpoints", () => {
  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await verifyCheckpoint(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    // The other direction too: a handler with no checkpoint behind it is dead
    // code that nothing can ever reach, and a sign the two drifted apart.
    const scenario = readFileSync(
      join(REPO_ROOT, "stackstack-base", "app", "scenarios", "onboarding.mjs"),
      "utf8",
    );
    const handlers = [...scenario.matchAll(/^ {2}"?([a-z][a-z0-9-]*)"?:\s*(?:\(|async)/gm)].map(
      (match) => match[1] as string,
    );
    expect(handlers.sort()).toEqual(metadata.scoring.checks.map((check) => check.id).sort());
  });

  it("should fail closed on a checkpoint id it does not know", async () => {
    const response = await verifyCheckpoint("no-such-checkpoint", "anything");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_checkpoint");
  });

  it("should fail closed on an inherited property name, not call it", async () => {
    // A plain object answers to `constructor` and `toString` with functions it
    // never declared. Looking a checkpoint up without an own-property check
    // would call one of those instead of rejecting the id.
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await verifyCheckpoint(inherited, "anything");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_checkpoint");
    }
  });

  it("should reject an empty or partial submission on every checkpoint", async () => {
    // Guards against a handler loosened to a substring or truthiness test: with
    // `includes` in place of an equality check, "" matches everything.
    const board = await get("/api/board");
    const posture = await get("/posture");
    const answers: Record<string, string> = {
      "board-open": board.body.serial,
      "log-trail": (
        (await get("/api/logs")).body.lines.find((line: { message: string }) =>
          line.message.startsWith("boot ok boot-check="),
        ).message as string
      ).split("=")[1] as string,
      "board-open-for-posts": "first post",
      handover: posture.body.readyToken as string,
    };
    for (const check of metadata.scoring.checks) {
      const right = answers[check.id] as string;
      expect(await verifyCheckpoint(check.id, "")).toHaveProperty("body.correct", false);
      expect(await verifyCheckpoint(check.id, " ")).toHaveProperty("body.correct", false);
      expect(await verifyCheckpoint(check.id, right.slice(0, -1))).toHaveProperty(
        "body.correct",
        false,
      );
      expect(await verifyCheckpoint(check.id, `${right}x`)).toHaveProperty("body.correct", false);
      // ...and the real answer still passes, so the assertions above are not
      // passing merely because the checkpoint rejects everything.
      expect(await verifyCheckpoint(check.id, right)).toHaveProperty("body.correct", true);
    }
  });

  it("should accept the serial the board prints, and nothing else", async () => {
    const board = await get("/api/board");
    expect((await verifyCheckpoint("board-open", board.body.serial)).body.correct).toBe(true);
    expect((await verifyCheckpoint("board-open", ` ${board.body.serial} `)).body.correct).toBe(true);
    expect((await verifyCheckpoint("board-open", "SS-00000000")).body.correct).toBe(false);
  });

  it("should accept the boot-check value from the log, not the whole log line", async () => {
    const logs = await get("/api/logs");
    const line = logs.body.lines.find((entry: { message: string }) =>
      entry.message.startsWith("boot ok boot-check="),
    ).message as string;
    const value = line.split("=")[1] as string;
    expect((await verifyCheckpoint("log-trail", value)).body.correct).toBe(true);
    expect((await verifyCheckpoint("log-trail", line)).body.correct).toBe(false);
  });

  it("should credit the post checkpoint only for a title the participant actually posted", async () => {
    expect((await verifyCheckpoint("board-open-for-posts", "first post")).body.correct).toBe(true);
    expect((await verifyCheckpoint("board-open-for-posts", "never posted")).body.correct).toBe(
      false,
    );
  });

  it("should not credit the post checkpoint for a title the board shipped with", async () => {
    // Otherwise reading the seeded posts would pass the checkpoint without a
    // single write going through the app.
    const board = await get("/api/board");
    const seeded = board.body.posts.find((entry: { seeded: boolean }) => entry.seeded);
    expect(seeded).toBeDefined();
    expect((await verifyCheckpoint("board-open-for-posts", seeded.title)).body.correct).toBe(false);
  });

  it("should refuse the post checkpoint again once the config is closed", async () => {
    // The post still exists, so this proves the checkpoint reads live config
    // rather than remembering that it was once open.
    writeConfig({ acceptingPosts: false });
    expect((await verifyCheckpoint("board-open-for-posts", "first post")).body.correct).toBe(false);
    writeConfig({ acceptingPosts: true });
  });

  it("should credit the handover only for the token posture actually emitted", async () => {
    const posture = await get("/posture");
    expect((await verifyCheckpoint("handover", posture.body.readyToken)).body.correct).toBe(true);
    expect((await verifyCheckpoint("handover", "TC{ready_0000000000000000}")).body.correct).toBe(
      false,
    );
  });

  it("should refuse the handover while any gate is red, even with the right token", async () => {
    // The token is stable across the run, so a participant who saw it once must
    // not keep the sign-off after breaking the environment again.
    const posture = await get("/posture");
    const token = posture.body.readyToken as string;
    writeConfig({ acceptingPosts: false });
    expect((await verifyCheckpoint("handover", token)).body.correct).toBe(false);
    writeConfig({ acceptingPosts: true });
    expect((await verifyCheckpoint("handover", token)).body.correct).toBe(true);
  });
});

describe("stackstack-onboarding gates on a fresh instance", () => {
  /**
   * Every gate asserted in its FALSE state. The main instance above only ever
   * observes them green, so a gate hardcoded to `true` — `post_created: () =>
   * true` is the dangerous one, since it would hand out the sign-off token to
   * someone who never wrote to the board — would survive the whole suite.
   */
  const port = 18194;
  const verifyPort = 18195;
  const base = `http://127.0.0.1:${port}`;
  let instance: ReturnType<typeof spawn>;
  let instanceConfig = "";

  beforeAll(async () => {
    instanceConfig = join(scratch, "gates.json");
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: false }));
    instance = spawn("bun", [SERVER], {
      env: {
        ...process.env,
        SCENARIO: "onboarding",
        FLAG_SEED: SEED,
        APP_CONFIG: instanceConfig,
        CHALLENGE_PORT: String(port),
        VERIFY_PORT: String(verifyPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const deadline = Date.now() + 4_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${verifyPort}/healthz`)).ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error("the gates instance never came up");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  afterAll(() => instance?.kill());

  const posture = async () =>
    (await (await fetch(`${base}/posture`)).json()) as {
      gates: Record<string, boolean>;
      ready: boolean;
      readyToken: string | null;
    };

  it("should start with every gate false and no sign-off token", async () => {
    // Probed through /verify's port, so asking does not itself trip a gate.
    const state = await posture();
    expect(state.gates).toEqual({
      board_visited: false,
      logs_read: false,
      posts_open: false,
      post_created: false,
    });
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should raise one gate at a time, and only the one earned", async () => {
    await fetch(`${base}/`);
    expect((await posture()).gates).toMatchObject({
      board_visited: true,
      logs_read: false,
      post_created: false,
    });

    await fetch(`${base}/api/logs`);
    expect((await posture()).gates).toMatchObject({ logs_read: true, post_created: false });

    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: true }));
    const opened = await posture();
    expect(opened.gates).toMatchObject({ posts_open: true, post_created: false });
    // The board is open but nothing has been written: the sign-off must not be
    // reachable yet.
    expect(opened.ready).toBe(false);
    expect(opened.readyToken).toBeNull();

    await fetch(`${base}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "you", title: "gate check", body: "" }),
    });
    const done = await posture();
    expect(done.gates.post_created).toBe(true);
    expect(done.ready).toBe(true);
    expect(done.readyToken).not.toBeNull();
  });

  it("should not raise a gate for a route it 404s", async () => {
    // The ROUTES guard on observe() is what keeps the observed set from growing
    // without bound; a path the app does not serve must not be recorded.
    const before = await posture();
    await fetch(`${base}/api/board-not-really`);
    expect((await posture()).gates).toEqual(before.gates);
  });

  it("should report a config whose only setting is misspelled", async () => {
    // `acceptingPost` instead of `acceptingPosts` is the edit a participant
    // actually makes by accident. Silently ignoring it would leave the board
    // closed with nothing anywhere saying why.
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPost: true }));
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(503);
    const body = (await health.json()) as { configError: string };
    expect(body.configError).toContain("acceptingPost");
    expect((await posture()).gates.posts_open).toBe(false);

    const rejected = await fetch(`${base}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "you", title: "blocked", body: "" }),
    });
    // Not a 409: telling them to set a flag they believe they already set is
    // the trap. The config itself is what will not load.
    expect(rejected.status).toBe(503);
    expect((await rejected.json()) as { error: string }).toHaveProperty(
      "error",
      "config_unreadable",
    );
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: true }));
  });

  it("should report a boolean written as a string", async () => {
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: "true" }));
    const body = (await (await fetch(`${base}/healthz`)).json()) as { configError: string };
    expect(body.configError).toContain("acceptingPosts must be boolean");
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: true }));
  });
});

describe("stackstack-onboarding without the app's own log route", () => {
  /**
   * The README offers `docker compose logs` as an equal alternative to
   * `GET /api/logs`, and a participant who takes it never sends the request the
   * `logs_read` gate was originally counting. That participant did the work, so
   * the sign-off has to be reachable for them too. This drives a second, clean
   * instance the way they would: read the boot line off the container's stdout,
   * answer the checkpoints, and never touch `/api/logs` or the board page.
   */
  const port = 18192;
  const verifyPort = 18193;
  const base = `http://127.0.0.1:${port}`;
  let instance: ReturnType<typeof spawn>;
  let stdout = "";
  let instanceConfig = "";

  const answer = async (checkpointId: string, submission: string) => {
    const response = await fetch(`http://127.0.0.1:${verifyPort}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId, submission }),
    });
    return ((await response.json()) as { correct: boolean }).correct;
  };

  beforeAll(async () => {
    instanceConfig = join(scratch, "second.json");
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: false }));
    instance = spawn("bun", [SERVER], {
      env: {
        ...process.env,
        SCENARIO: "onboarding",
        FLAG_SEED: SEED,
        APP_CONFIG: instanceConfig,
        CHALLENGE_PORT: String(port),
        VERIFY_PORT: String(verifyPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    instance.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const deadline = Date.now() + 4_000;
    for (;;) {
      if (/boot ok boot-check=[0-9a-f]{12}/.test(stdout)) break;
      if (Date.now() > deadline) throw new Error("the second instance never logged its boot line");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  afterAll(() => instance?.kill());

  it("should not count a wrong answer as having looked", async () => {
    // Runs first, on the untouched instance: `remember` must record the verdict,
    // not the attempt, or a participant could open the gate by guessing.
    const before = (await (await fetch(`${base}/posture`)).json()) as {
      gates: Record<string, boolean>;
    };
    expect(before.gates.logs_read).toBe(false);
    expect(await answer("log-trail", "000000000000")).toBe(false);
    const after = (await (await fetch(`${base}/posture`)).json()) as {
      gates: Record<string, boolean>;
    };
    expect(after.gates.logs_read).toBe(false);
  });

  it("should reach the sign-off from the container log alone", async () => {
    const serial = /serial=(SS-[0-9a-f]{8})/.exec(stdout)?.[1] as string;
    const bootCheck = /boot ok boot-check=([0-9a-f]{12})/.exec(stdout)?.[1] as string;
    expect(await answer("board-open", serial)).toBe(true);
    expect(await answer("log-trail", bootCheck)).toBe(true);

    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: true }));
    const posted = await fetch(`${base}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ author: "you", title: "from the log", body: "" }),
    });
    expect(posted.status).toBe(201);

    const posture = (await (await fetch(`${base}/posture`)).json()) as {
      gates: Record<string, boolean>;
      readyToken: string | null;
    };
    // Neither GET / nor GET /api/logs was ever requested on this instance.
    expect(posture.gates.board_visited).toBe(true);
    expect(posture.gates.logs_read).toBe(true);
    expect(posture.readyToken).not.toBeNull();
    expect(await answer("handover", posture.readyToken as string)).toBe(true);
  });
});

describe("stackstack-onboarding wiring", () => {
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

  it("should publish the challenge endpoint's port, on loopback only", () => {
    for (const url of Object.values(metadata.runtime.challengeEndpoints)) {
      expect(service.ports).toContain(`127.0.0.1:${new URL(url).port}:8080`);
    }
    for (const published of service.ports) expect(published.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should publish the verify port on loopback only", () => {
    expect(service.ports).toContain(`127.0.0.1:${new URL(metadata.runtime.verifyUrl).port}:8081`);
  });

  it("should declare exactly the ports it publishes", () => {
    // exposedPorts is what the portal shows the participant; a stale entry sends
    // them to a port nothing is listening on.
    const published = service.ports
      .map((entry) => Number(entry.split(":")[1]))
      .sort((a, b) => a - b);
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    // Resolved rather than string-matched: the relative context is what the
    // platform's local runner pins with --project-directory, and a wrong number
    // of `../` would only surface at `make local` time.
    expect(service.build.context).toBe("../../../stackstack-base");
    const dockerfile = join(composeDir, service.build.context, service.build.dockerfile);
    expect(existsSync(dockerfile)).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("onboarding");
    expect(
      existsSync(
        join(composeDir, service.build.context, "app", "scenarios", "onboarding.mjs"),
      ),
    ).toBe(true);
  });

  it("should mount the participant's config read-only, at the path the app reads", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
  });

  it("should name the config path as the participant sees it, from the platform checkout", () => {
    // A participant runs `make local` from the TenkaCloud repository, where this
    // catalog is the `problems/` submodule. The participant no longer edits the
    // file at all — changes go through PATCH /api/config — so the compose file
    // must not carry a "path to open" hint for anyone to resurrect in copy.
    expect(service.environment.CONFIG_HINT).toBeUndefined();
    const inThisRepo = "challenges/stackstack-onboarding/local/config/app.json";
    expect(existsSync(join(REPO_ROOT, inThisRepo))).toBe(true);
  });

  it("should steer every participant-facing doc to the API, never to the checkout file", () => {
    // Solving by editing the tracked file rewrites the problem itself: git goes
    // dirty and no rebuild restores the broken state. Any doc that names the
    // path invites exactly that, so naming it anywhere participant-facing is
    // the regression this test exists to catch.
    const checkoutPath = "challenges/stackstack-onboarding/local/config/app.json";
    for (const name of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = readFileSync(join(PROBLEM_DIR, name), "utf8");
      expect(text).not.toContain(checkoutPath);
      expect(text).toContain("api/config");
    }
  });

  it("should ship the config file the compose file mounts", () => {
    const shipped = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    // Shipped closed: opening it is the participant's one required change.
    expect(shipped.acceptingPosts).toBe(false);
  });
});
