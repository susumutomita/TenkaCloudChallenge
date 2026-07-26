import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const CONFIG_HINT = "challenges/stackstack-onboarding/local/config/app.json";

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
      CONFIG_HINT: CONFIG_HINT,
      CHALLENGE_PORT: String(CHALLENGE_PORT),
      VERIFY_PORT: String(VERIFY_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const deadline = Date.now() + 20_000;
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

  it("should name the config file by the path in the checkout, not the mounted one", async () => {
    // The app only ever sees /app/config/app.json, which is not a path the
    // participant can open. Printing that would be the problem's first trap.
    const page = await get("/");
    expect(page.text).toContain(CONFIG_HINT);
    expect(page.text).not.toContain("/app/config/app.json");
  });

  it("should 404 a route it does not serve", async () => {
    const missing = await get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("not_found");
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

  it("should refuse a post while the board is closed, and say which setting opens it", async () => {
    const rejected = await post("/api/posts", { author: "you", title: "too early", body: "" });
    expect(rejected.status).toBe(409);
    expect(rejected.body.detail).toContain("acceptingPosts");
    expect(rejected.body.detail).toContain(CONFIG_HINT);
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
  });

  it("should fail closed on a checkpoint id it does not know", async () => {
    const response = await verifyCheckpoint("no-such-checkpoint", "anything");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_checkpoint");
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
    const deadline = Date.now() + 20_000;
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

  it("should name a config path that exists in the checkout", () => {
    expect(existsSync(join(REPO_ROOT, service.environment.CONFIG_HINT as string))).toBe(true);
  });

  it("should ship the config file the compose file mounts", () => {
    const shipped = JSON.parse(
      readFileSync(join(PROBLEM_DIR, "local", "config", "app.json"), "utf8"),
    ) as { acceptingPosts: boolean };
    // Shipped closed: opening it is the participant's one required change.
    expect(shipped.acceptingPosts).toBe(false);
  });
});
