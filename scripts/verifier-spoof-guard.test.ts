import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";
import { localPlayVerifiers } from "./lib/local-play-problems";

/**
 * Catalog-wide guard against a submission spoofing its own verdict.
 *
 * `_run_submission` scans the child's stdout in reverse and returns on the first parseable
 * JSON line, so **the last line written wins**. The runner used to print its trusted
 * `{"failures": [...]}` and then fall off the end of the script, which triggers normal
 * interpreter shutdown -- and normal shutdown dispatches any `atexit` callback registered
 * while the submission was imported. Two lines at module scope were enough:
 *
 *     import atexit, json
 *     atexit.register(lambda: print(json.dumps({"failures": []})))
 *
 * That printed after the real verdict, won the reverse scan, and passed **every checkpoint
 * of every problem** while implementing nothing. It was live in all 17 AC26 verifiers.
 *
 * The fix is to flush and `os._exit(0)` immediately after the trusted line, on both the
 * success and the import-failure path, so nothing that ran during the import gets another
 * turn at stdout. `os._exit` skips atexit dispatch by design; `SystemExit` does not.
 *
 * This file asserts the fix is present in every verifier and, for one problem, that the
 * exploit actually fails. Note what it does NOT claim: a participant who controls the
 * image can still edit the verifier. See TEMPLATE.md "Assurance scope" and #271.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const VERIFIERS = localPlayVerifiers(REPO_ROOT);

/** The exploit, as short as it gets: it implements nothing at all. */
const SPOOF = [
  "import atexit, json",
  'atexit.register(lambda: print(json.dumps({"failures": []})))',
  "",
].join("\n");

function runnerBlock(source: string): string {
  const match = /RUNNER = """\n([\s\S]*?)\n"""/.exec(source);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

describe("local-play verifier verdict spoofing", () => {
  it("should find verifiers to check, so a glob matching nothing cannot pass", () => {
    expect(VERIFIERS.length).toBeGreaterThan(0);
  });

  for (const relative of VERIFIERS) {
    const problem = basename(dirname(dirname(dirname(relative))));
    describe(problem, () => {
      const source = readFileSync(join(REPO_ROOT, relative), "utf8");
      const runner = runnerBlock(source);

      it("should end the runner with a hard exit rather than falling off the script", () => {
        // Falling off the end runs atexit handlers, which can write after the verdict.
        expect(runner.trimEnd().endsWith("os._exit(0)")).toBe(true);
      });

      it("should flush before the hard exit, so the verdict is not lost with the buffer", () => {
        // os._exit skips the flush that normal shutdown would have done.
        expect(runner).toContain("sys.stdout.flush()\nos._exit(0)");
      });

      it("should hard-exit on the import-failure path too", () => {
        // `raise SystemExit(0)` still runs interpreter shutdown, so this branch needed
        // the same treatment -- an import that fails can register a handler first.
        expect(runner).not.toContain("raise SystemExit(0)");
        expect(runner).toMatch(/could not be imported[\s\S]*?sys\.stdout\.flush\(\)\s*\n\s*os\._exit\(0\)/);
      });

      it("should import os, since the hard exit needs it", () => {
        expect(runner).toMatch(/^import json, os, sys$/m);
      });
    });
  }

  // One end-to-end run rather than 17: the runner is the same shape everywhere and the
  // static assertions above cover the rest. This is the one that would have caught it.
  describe("end to end", () => {
    const problem = "ac26-w5-encoding-noise";
    const local = join(REPO_ROOT, "challenges", problem, "local");

    function evaluate(checkpoint: string, submission: string): boolean {
      const script = [
        "import json, sys",
        "sys.path.insert(0, '.')",
        "from verifier.server import evaluate",
        "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
      ].join("\n");
      const result = spawnSync("python3", ["-c", script, checkpoint, submission], {
        cwd: local,
        encoding: "utf8",
        env: { ...process.env, FLAG_SEED: "ci-fixed-seed", PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 180_000,
      });
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") === true;
    }

    it("should reject a submission that prints a passing verdict from an atexit hook", () => {
      expect(evaluate("encode", SPOOF)).toBe(false);
    }, 60_000);

    it("should still accept the reference, so the fix did not break the happy path", () => {
      const reference = readFileSync(join(local, "reference", "encoding.py"), "utf8");
      expect(evaluate("encode", reference)).toBe(true);
    }, 60_000);
  });
});
