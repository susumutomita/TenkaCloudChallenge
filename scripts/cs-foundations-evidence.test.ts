import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * The defect this file exists for: `question` lived in `show.py` and the Workbench
 * rebuilt the same evidence by hand without it, so a participant solving in the Portal
 * was handed raw JSON and was never told what was being asked. It went unnoticed
 * through five problem PRs because nothing compared the two surfaces.
 *
 * Scope is every cs-foundations problem. The first-cohort four were converted to the
 * same shared-`QUESTIONS` shape in
 * https://github.com/susumutomita/TenkaCloudChallenge/issues/457; before that they each
 * rebuilt the Portal payload separately, and three of the four served evidence with no
 * question attached at all.
 *
 * The server module lives under a different directory per problem, so it is named here
 * rather than guessed. Getting it wrong makes the import fail loudly, not skip.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PROBLEMS = [
  { id: "cs-atomic-file-publish", serverDir: "workbench" },
  { id: "cs-numeric-aggregation-order", serverDir: "workbench" },
  { id: "cs-protocol-state-guard", serverDir: "workbench" },
  { id: "cs-http-retry-idempotency", serverDir: "workbench" },
  { id: "cs-dst-daily-rollup", serverDir: "workbench" },
  { id: "cs-pagination-drift", serverDir: "workbench" },
  { id: "cs-async-result-binding", serverDir: "portal" },
  { id: "cs-auth-claim-audit", serverDir: "verifier" },
  { id: "cs-cache-generation-fence", serverDir: "participant" },
  { id: "cs-transaction-visibility-audit", serverDir: "participant" },
] as const;

function surfaces(
  problem: string,
  serverDir: string,
): { cli: Record<string, any>; portal: Record<string, any> } {
  const local = join(ROOT, "challenges", problem, "local");
  const raw = execFileSync(
    "python3",
    [
      "-c",
      `
import io, json, sys, contextlib
sys.path.insert(0, "."); sys.path.insert(0, ${JSON.stringify(serverDir)})
import show, server
buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    show.main()
portal = server.inspect_payload("evidence-parity-seed")
# The interpreter version is the one thing the browser adds and the terminal has no
# reason to print. Problems without an environment block simply have nothing to strip.
if isinstance(portal.get("environment"), dict):
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
  for (const { id: problem, serverDir } of PROBLEMS) {
    it(`${problem}: the Portal shows what the CLI shows`, () => {
      const { cli, portal } = surfaces(problem, serverDir);
      // Identical, not merely overlapping: a Portal payload rebuilt by hand is exactly
      // how the questions went missing in the first place.
      expect(portal).toEqual(cli);
    });

    it(`${problem}: every graded evidence block states its question`, () => {
      const { portal } = surfaces(problem, serverDir);
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

    it(`${problem}: every direct-answer checkpoint states the shape it accepts`, () => {
      const { portal } = surfaces(problem, serverDir);
      const metadata = JSON.parse(
        readFileSync(join(ROOT, "challenges", problem, "metadata.json"), "utf8"),
      ) as { scoring: { checks: { id: string }[] } };
      const graded = new Set(metadata.scoring.checks.map((check) => check.id));
      // Only blocks that are themselves a checkpoint. An orientation block that is read
      // but never submitted has no shape to declare, and `environment` is always the
      // pass phrase pasted verbatim.
      const answered = Object.keys(portal).filter(
        (name) => name !== "environment" && graded.has(name),
      );
      expect(answered.length).toBeGreaterThan(0);
      for (const name of answered) {
        const block = portal[name] as Record<string, any>;
        // Without this the verdict vocabulary is unguessable: these checkpoints compare
        // against one exact string, and three of them never published the alternatives.
        expect(typeof block.answerFormat).toBe("string");
        expect(typeof block.i18n?.en?.answerFormat).toBe("string");
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
