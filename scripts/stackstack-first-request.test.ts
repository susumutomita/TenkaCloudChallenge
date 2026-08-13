import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * stackstack-first-request is chapter 0 of the stackstack-route: the first
 * deliberate HTTP round trips a complete beginner ever makes. What must never
 * break is the three conversations themselves — read the postcard, get refused
 * by the door and fix the request, sign the guestbook — and the promise that
 * every submittable value appears only in a response the participant earned.
 *
 * These tests drive the real app over real HTTP, like the onboarding suite:
 * the base app deliberately depends on nothing outside `node:http` and
 * `node:crypto` so it runs under Bun here and under Node 22 in the container.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const PROBLEM_DIR = join(REPO_ROOT, "challenges", "stackstack-first-request");
const SERVER = join(REPO_ROOT, "stackstack-base", "app", "server.mjs");

// Ports clear of the catalog's 18080/18081 convention and of every other suite.
const CHALLENGE_PORT = 18220;
const VERIFY_PORT = 18221;
const BOARD = `http://127.0.0.1:${CHALLENGE_PORT}`;
const VERIFY = `http://127.0.0.1:${VERIFY_PORT}/verify`;
const SEED = "stackstack-first-request-test-seed";

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
let configPath = "";
let server: ReturnType<typeof spawn>;

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
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
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
  scratch = mkdtempSync(join(tmpdir(), "stackstack-first-request-"));
  configPath = join(scratch, "app.json");
  writeFileSync(configPath, readFileSync(join(PROBLEM_DIR, "local", "config", "app.json")));

  server = spawn("bun", [SERVER], {
    env: {
      ...process.env,
      SCENARIO: "first-request",
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

describe("stackstack-first-request scoring regulation", () => {
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
    const spent = metadata.scoring.checks
      .flatMap((check) => check.hints ?? [])
      .reduce((sum, hint) => sum + hint.penalty, 0);
    expect(spent).toBeLessThanOrEqual(50);
  });

  it("should spend the Easy tier's whole wrong-answer budget and no more", () => {
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

describe("stackstack-first-request three conversations", () => {
  it("should serve the board with the homework posts a beginner starts from", async () => {
    const page = await get("/");
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/board serial: <code>SS-[0-9a-f]{8}<\/code>/);
    // The quest log lives on the board itself: all three routes are named there.
    expect(page.text).toContain("/api/postcard");
    expect(page.text).toContain("/api/door");
    expect(page.text).toContain("/api/guestbook");
  });

  it("should keep every board link relative, so a forwarded Codespaces origin works", async () => {
    const page = await get("/");
    expect(page.text).not.toContain("http://127.0.0.1");
    expect(page.text).not.toContain("http://localhost");
  });

  it("should deliver the postcard with the door's password in the response", async () => {
    const postcard = await get("/api/postcard");
    expect(postcard.status).toBe(200);
    expect(postcard.body.token).toMatch(/^postcard-[0-9a-f]{12}$/);
  });

  it("should refuse the door without a key, and attach the fix", async () => {
    const refused = await get("/api/door");
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("key_required");
    // The 400 is the lesson: its detail must point at the postcard, not at a
    // person. A refusal with no way forward would teach "errors are dead ends".
    expect(refused.body.detail).toContain("/api/postcard");
    expect(refused.body.detail).toContain("?key=");
  });

  it("should refuse a wrong key differently from a missing one", async () => {
    const refused = await get("/api/door?key=not-the-postcard");
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("wrong_key");
    expect(refused.body.detail).toContain("/api/postcard");
  });

  it("should open the door for the postcard token, whitespace included", async () => {
    const token = (await get("/api/postcard")).body.token as string;
    const opened = await get(`/api/door?key=${encodeURIComponent(` ${token} `)}`);
    expect(opened.status).toBe(200);
    expect(opened.body.token).toMatch(/^TC\{door_[0-9a-f]{16}\}$/);
  });

  it("should start the guestbook empty and list what was accepted", async () => {
    const before = await get("/api/guestbook");
    expect(before.status).toBe(200);
    expect(Array.isArray(before.body.entries)).toBe(true);

    const accepted = await post("/api/guestbook", { name: "newcomer", message: "hello" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.receipt).toMatch(/^TC\{guestbook_[0-9a-f]{16}\}$/);
    expect(accepted.body.entry).toMatchObject({ name: "newcomer", message: "hello" });

    const after = await get("/api/guestbook");
    expect(after.body.entries.map((entry: { name: string }) => entry.name)).toContain("newcomer");
    // The receipt is never listed back: it exists only in the 201 response.
    expect(JSON.stringify(after.body)).not.toContain("TC{guestbook_");
  });

  it("should reject a malformed guestbook entry with the reason, not a reset", async () => {
    const noName = await post("/api/guestbook", { message: "hello" });
    expect(noName.status).toBe(400);
    expect(noName.body.detail).toContain("name");

    const noMessage = await post("/api/guestbook", { name: "you" });
    expect(noMessage.status).toBe(400);
    expect(noMessage.body.detail).toContain("message");

    const notAnObject = await post("/api/guestbook", "just words");
    expect(notAnObject.status).toBe(400);

    const blank = await post("/api/guestbook", { name: "   ", message: "hi" });
    expect(blank.status).toBe(400);
  });

  it("should reject a body larger than the app will read, with an answer rather than a reset", async () => {
    const rejected = await post("/api/guestbook", {
      name: "big",
      message: "x".repeat(20 * 1024),
    });
    expect(rejected.status).toBe(413);
  });

  it("should keep a curious board post working, because chapter 0 ships the board open", async () => {
    // Deliberately the opposite of onboarding's shipped config: config editing
    // is onboarding's lesson, so nothing here may dead-end in a 409.
    const posted = await post("/api/posts", { author: "you", title: "just looking", body: "" });
    expect(posted.status).toBe(201);
  });
});

describe("stackstack-first-request posture and checkpoints", () => {
  it("should turn every gate green once the three conversations happened", async () => {
    const posture = await get("/posture");
    expect(posture.body.gates).toEqual({
      postcard_read: true,
      door_opened: true,
      message_left: true,
    });
    expect(posture.body.ready).toBe(true);
    expect(posture.body.readyToken).toMatch(/^TC\{ready_[0-9a-f]{16}\}$/);
  });

  it("should define a handler for exactly the checkpoints metadata declares", async () => {
    for (const check of metadata.scoring.checks) {
      const response = await verifyCheckpoint(check.id, "");
      expect(response.status).toBe(200);
      expect(response.body.checkpointId).toBe(check.id);
    }
    // The other direction: a handler with no checkpoint behind it is dead code.
    const scenario = readFileSync(
      join(REPO_ROOT, "stackstack-base", "app", "scenarios", "first-request.mjs"),
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
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      const response = await verifyCheckpoint(inherited, "anything");
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("unknown_checkpoint");
    }
  });

  it("should reject an empty or partial submission on every checkpoint", async () => {
    const postcard = (await get("/api/postcard")).body.token as string;
    const door = (await get(`/api/door?key=${postcard}`)).body.token as string;
    const guestbook = (await post("/api/guestbook", { name: "again", message: "hi" })).body
      .receipt as string;
    const posture = await get("/posture");
    const answers: Record<string, string> = {
      postcard,
      "locked-door": door,
      guestbook,
      "round-trip": posture.body.readyToken as string,
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
      // ...and the real answer still passes, so the rejections above are not
      // the checkpoint rejecting everything.
      expect(await verifyCheckpoint(check.id, right)).toHaveProperty("body.correct", true);
    }
  });

  it("should refuse the round trip while any gate is red, even with the right token", async () => {
    // Probed on a clean instance below; here the equivalent invariant is that
    // the token posture emitted is only credited while posture is still ready.
    const posture = await get("/posture");
    expect(posture.body.ready).toBe(true);
    expect(
      (await verifyCheckpoint("round-trip", posture.body.readyToken as string)).body.correct,
    ).toBe(true);
    expect(
      (await verifyCheckpoint("round-trip", "TC{ready_0000000000000000}")).body.correct,
    ).toBe(false);
  });
});

describe("stackstack-first-request gates on a fresh instance", () => {
  /**
   * Every gate asserted in its FALSE state, and raised one at a time. The main
   * instance above only ever observes them green, so a gate hardcoded to `true`
   * would survive the whole suite without this.
   */
  const port = 18222;
  const verifyPort = 18223;
  const base = `http://127.0.0.1:${port}`;
  let instance: ReturnType<typeof spawn>;
  let instanceConfig = "";

  const answer = async (checkpointId: string, submission: string) => {
    const response = await fetch(`http://127.0.0.1:${verifyPort}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ checkpointId, submission }),
    });
    return ((await response.json()) as { correct: boolean }).correct;
  };

  const posture = async () =>
    (await (await fetch(`${base}/posture`)).json()) as {
      gates: Record<string, boolean>;
      ready: boolean;
      readyToken: string | null;
    };

  beforeAll(async () => {
    instanceConfig = join(scratch, "gates.json");
    writeFileSync(instanceConfig, JSON.stringify({ boardTitle: "b", acceptingPosts: true }));
    instance = spawn("bun", [SERVER], {
      env: {
        ...process.env,
        SCENARIO: "first-request",
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

  it("should start with every gate false and no round-trip token", async () => {
    // Probed through /verify's port, so asking does not itself trip a gate.
    const state = await posture();
    expect(state.gates).toEqual({
      postcard_read: false,
      door_opened: false,
      message_left: false,
    });
    expect(state.ready).toBe(false);
    expect(state.readyToken).toBeNull();
  });

  it("should not count a wrong answer as having done the work", async () => {
    // `remember` must record the verdict, not the attempt.
    expect(await answer("postcard", "postcard-000000000000")).toBe(false);
    expect(await answer("locked-door", "TC{door_0000000000000000}")).toBe(false);
    const state = await posture();
    expect(state.gates.postcard_read).toBe(false);
    expect(state.gates.door_opened).toBe(false);
  });

  it("should raise one gate at a time, and only the one earned", async () => {
    await fetch(`${base}/api/postcard`);
    expect((await posture()).gates).toEqual({
      postcard_read: true,
      door_opened: false,
      message_left: false,
    });

    // A refused door does not open the gate: the gate is the successful repair.
    await fetch(`${base}/api/door`);
    await fetch(`${base}/api/door?key=wrong`);
    expect((await posture()).gates.door_opened).toBe(false);

    const token = ((await (await fetch(`${base}/api/postcard`)).json()) as { token: string })
      .token;
    await fetch(`${base}/api/door?key=${token}`);
    expect((await posture()).gates).toMatchObject({ door_opened: true, message_left: false });

    // A rejected guestbook entry earns nothing either.
    await fetch(`${base}/api/guestbook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "no message" }),
    });
    const beforeWrite = await posture();
    expect(beforeWrite.gates.message_left).toBe(false);
    expect(beforeWrite.ready).toBe(false);
    expect(beforeWrite.readyToken).toBeNull();

    await fetch(`${base}/api/guestbook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "you", message: "gate check" }),
    });
    const done = await posture();
    expect(done.gates.message_left).toBe(true);
    expect(done.ready).toBe(true);
    expect(done.readyToken).not.toBeNull();
    expect(await answer("round-trip", done.readyToken as string)).toBe(true);
  });

  it("should not raise a gate for a route it 404s", async () => {
    const before = await posture();
    await fetch(`${base}/api/postcard-not-really`);
    expect((await posture()).gates).toEqual(before.gates);
  });
});

describe("stackstack-first-request wiring", () => {
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
    const published = service.ports
      .map((entry) => Number(entry.split(":")[1]))
      .sort((a, b) => a - b);
    const declared = metadata.exposedPorts.map((entry) => entry.port).sort((a, b) => a - b);
    expect(declared).toEqual(published);
  });

  it("should build the shared base image rather than a copy of it", () => {
    expect(service.build.context).toBe("../../../stackstack-base");
    const dockerfile = join(composeDir, service.build.context, service.build.dockerfile);
    expect(existsSync(dockerfile)).toBe(true);
    expect(existsSync(join(composeDir, service.build.context, "app", "server.mjs"))).toBe(true);
  });

  it("should select the scenario whose checkpoint handlers metadata declares", () => {
    expect(service.environment.SCENARIO).toBe("first-request");
    expect(
      existsSync(join(composeDir, service.build.context, "app", "scenarios", "first-request.mjs")),
    ).toBe(true);
  });

  it("should mount the participant's config read-only, at the path the app reads", () => {
    expect(service.volumes).toEqual(["./config:/app/config:ro"]);
    expect(existsSync(join(composeDir, "config", "app.json"))).toBe(true);
  });

  it("should ship the board open, so nothing in chapter 0 dead-ends in a 409", () => {
    // Deliberately the opposite of onboarding: opening the board is
    // onboarding's one required change, and this problem must not spoil it —
    // nor send a beginner into a refusal the chapter never explains.
    const shipped = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    expect(shipped.acceptingPosts).toBe(true);
  });

  it("should steer every participant-facing doc to the console, never to the checkout file", () => {
    const checkoutPath = "challenges/stackstack-first-request/local/config/app.json";
    for (const name of ["README.md", "README.ja.md", "metadata.json"]) {
      const text = readFileSync(join(PROBLEM_DIR, name), "utf8");
      expect(text).not.toContain(checkoutPath);
    }
  });
});
