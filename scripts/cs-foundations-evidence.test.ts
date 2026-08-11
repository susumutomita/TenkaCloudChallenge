import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * The defect this file exists for: `question` lived in `show.py` and the Workbench
 * rebuilt the same evidence by hand without it, so a participant solving in the Portal
 * was handed raw JSON and was never told what was being asked. It went unnoticed
 * through five problem PRs because nothing compared the two surfaces.
 *
 * Scope is the problems that serve a JSON evidence payload from a shared `QUESTIONS`
 * map. The earlier cs-foundations problems print prose from `show.py` instead and do
 * not have a Workbench evidence payload to compare against; they are tracked in
 * https://github.com/susumutomita/TenkaCloudChallenge/issues/457 rather than asserted
 * here, because a check that silently skips them would read as coverage it does not have.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PROBLEMS = [
  "cs-atomic-file-publish",
  "cs-numeric-aggregation-order",
  "cs-protocol-state-guard",
  "cs-http-retry-idempotency",
  "cs-dst-daily-rollup",
] as const;

function surfaces(problem: string): { cli: Record<string, any>; portal: Record<string, any> } {
  const local = join(ROOT, "challenges", problem, "local");
  const raw = execFileSync(
    "python3",
    [
      "-c",
      `
import io, json, sys, contextlib
sys.path.insert(0, "."); sys.path.insert(0, "workbench")
import show, server
buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    show.main()
portal = server.inspect_payload("evidence-parity-seed")
portal["environment"].pop("python", None)
print(json.dumps({"cli": json.loads(buffer.getvalue()), "portal": portal}, ensure_ascii=False))
`,
    ],
    {
      cwd: local,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "evidence-parity-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    },
  );
  return JSON.parse(raw) as { cli: Record<string, any>; portal: Record<string, any> };
}

describe("cs-foundations evidence", () => {
  for (const problem of PROBLEMS) {
    it(`${problem}: the Portal shows what the CLI shows`, () => {
      const { cli, portal } = surfaces(problem);
      // Identical, not merely overlapping: a Portal payload rebuilt by hand is exactly
      // how the questions went missing in the first place.
      expect(portal).toEqual(cli);
    });

    it(`${problem}: every graded evidence block states its question`, () => {
      const { portal } = surfaces(problem);
      const blocks = Object.keys(portal).filter((name) => name !== "environment");
      // A problem with no evidence block would make the assertions below vacuous.
      expect(blocks.length).toBeGreaterThan(0);
      for (const name of blocks) {
        const block = portal[name] as Record<string, any>;
        expect(typeof block.question).toBe("string");
        expect((block.question as string).length).toBeGreaterThan(10);
        // Japanese default with an English mirror, the convention metadata.json uses.
        expect(typeof block.i18n?.en?.question).toBe("string");
      }
    });

    it(`${problem}: the answer file the participant edits is tracked`, () => {
      // Reset restores the starter from git, so existence alone is insufficient:
      // require at least one tracked path under the starter directory.
      const starter = join("challenges", problem, "local", "starter");
      const tracked = execFileSync("git", ["ls-files", "--cached", "--", starter], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(tracked.trim().length).toBeGreaterThan(0);
    });
  }
});
