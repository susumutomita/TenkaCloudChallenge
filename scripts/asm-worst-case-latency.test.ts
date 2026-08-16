import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const LOCAL = join(REPO_ROOT, "challenges", "asm-worst-case-latency", "local");

function runPython(program: string): string {
  return execFileSync("python3", ["-c", program], {
    cwd: LOCAL,
    encoding: "utf8",
    env: {
      ...process.env,
      FLAG_SEED: "local-dev-seed",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  }).trim();
}

describe("asm-worst-case-latency grading boundary", () => {
  it("derives a genuinely unseen generalize seed even when FLAG_SEED exceeds eight bytes", () => {
    const seeds = runPython([
      "from verifier.server import _seed_for",
      "print(_seed_for('measure'), _seed_for('generalize'))",
    ].join("\n")).split(" ");
    expect(seeds).toHaveLength(2);
    expect(seeds[1]).not.toBe(seeds[0]);
  });

  it("rejects jecxz because one control-flow instruction is still control flow", () => {
    const verdict = runPython([
      "from tests.hidden.check_candidate import Rejected, exactly_one_instruction",
      "try:",
      "    exactly_one_instruction(['jecxz'])",
      "except Rejected:",
      "    print('rejected')",
      "else:",
      "    print('accepted')",
    ].join("\n"));
    expect(verdict).toBe("rejected");
  });
});
