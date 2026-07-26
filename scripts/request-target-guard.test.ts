import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";

/**
 * Catalog-wide guard: a malformed request target must never end a problem's
 * container.
 *
 * `GET //` is a protocol-relative reference with no authority, and `new URL`
 * rejects it. Every local-play app parsed the request target with an unguarded
 * `new URL(request.url ?? "/", base)` on the first line of its handler, so the
 * throw escaped as a fatal error and the process exited. That is worse than it
 * sounds: each of these apps serves its challenge surface *and* its `/verify`
 * scorer from one process, and the compose files set `restart: "no"` — so one
 * stray slash took down the app, the scorer, and every bit of in-memory state
 * the participant had built up, with nothing to bring it back.
 *
 * It was reachable by accident. `new URL("http://localhost:18080//").pathname`
 * is `"//"`, so a browser pointed at a URL with a doubled slash sends exactly
 * this, as does any client that joins a base URL ending in `/` with a
 * leading-slash path.
 *
 * It was live in 15 call sites across 10 problems. The fix is per-file, because
 * each image copies only its own `local/app/` and there is no shared module to
 * import from — so this test is what keeps the next one from drifting back.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

/**
 * Every app module that parses a request target into a URL — matched on the
 * parse itself, guarded or not, so a file that regresses to the bare form is
 * still in scope. Test modules alongside the app are excluded: they mention
 * `request.url` while driving the app, but route nothing themselves.
 */
const APPS = globSync("challenges/*/local/app/*.mjs", { cwd: REPO_ROOT })
  .filter((relative) => !relative.endsWith(".test.mjs"))
  .filter((relative) =>
    /(?:new URL|requestUrl)\(\s*request\.url\b/.test(readFileSync(join(REPO_ROOT, relative), "utf8")),
  )
  .sort();

/**
 * The apps that boot under Bun, so this suite can prove the fix rather than
 * just its shape.
 *
 * The others depend on `node:sqlite` (Node 22's `--experimental-sqlite`), which
 * Bun 1.3.11 does not implement, and this repo's CI provisions only Bun. They
 * are covered by the static assertion below; the same helper text is in every
 * file, and the behaviour it produces is pinned here on the four that can run.
 * Docker — which players and `make local` actually use — ships real Node 22 and
 * runs all of them.
 */
const RUNNABLE = [
  "xss-demo",
  "csrf-demo",
  "hollow-invite",
  "wix-exposure-audit",
] as const;

/** Every one of these apps hard-codes its listener; they are run one at a time. */
const CHALLENGE_PORT = 8080;

describe("request-target parsing across the catalog", () => {
  it("should find the local-play apps to check, so a glob matching nothing cannot pass", () => {
    expect(APPS.length).toBeGreaterThan(0);
  });

  it.each(APPS)("%s should not parse a request target unguarded", (relative) => {
    const source = readFileSync(join(REPO_ROOT, relative), "utf8");
    // The bare form is the defect. Anything reading `request.url` into a URL has
    // to go through a helper that cannot throw.
    expect(source).not.toMatch(/new URL\(\s*request\.url\b/);
    expect(source).toMatch(/requestUrl\(request\.url\b/);
  });

  it.each(APPS)("%s should answer, not crash, on an unparseable target", (relative) => {
    // The helper's own contract, asserted on the shipped source: a target that
    // cannot be parsed becomes one the router will not match.
    const source = readFileSync(join(REPO_ROOT, relative), "utf8");
    expect(source).toContain("__malformed_request__");
  });
});

/** Send one raw request line; a normal client would normalise `//` away. */
function sendRawTarget(port: number, target: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: probe.local\r\nConnection: close\r\n\r\n`);
    });
    socket.on("close", () => resolve());
    socket.on("error", () => resolve());
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve();
    });
  });
}

async function reachable(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

describe("a malformed target does not take the container down", () => {
  it.each(RUNNABLE)("%s should still be serving after GET //", async (problem) => {
    const entry = APPS.find(
      (relative) => relative.startsWith(`challenges/${problem}/`) && relative.endsWith("server.mjs"),
    );
    expect(entry).toBeDefined();

    const app = spawn("bun", ["server.mjs"], {
      cwd: join(REPO_ROOT, dirname(entry as string)),
      env: { ...process.env, FLAG_SEED: "request-target-guard-test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    app.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    try {
      const deadline = Date.now() + 8_000;
      let up = false;
      while (Date.now() < deadline && !(up = await reachable(CHALLENGE_PORT))) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      // A bind failure would otherwise read as "the app crashed", which is the
      // very thing under test — so say which it was.
      expect(up, `${problem} never came up; stderr: ${stderr.slice(0, 400)}`).toBe(true);

      for (const target of ["//", "///", "//%"]) {
        await sendRawTarget(CHALLENGE_PORT, target);
        expect(
          await reachable(CHALLENGE_PORT),
          `${problem} died on GET ${target}; stderr: ${stderr.slice(0, 400)}`,
        ).toBe(true);
      }
    } finally {
      app.kill();
      // Give the port back before the next app in the list claims it.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  });
});
