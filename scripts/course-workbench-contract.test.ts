import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const ROOT = join(import.meta.dir, "..");

describe("course Browser Workbench contract", () => {
  it(
    "keeps all 29 AC26 and SHA-256 problems solvable from the Participant Portal",
    () => {
      // The Python contract includes one-line, deployment-bound submission envelopes
      // for code and direct-answer checkpoints, plus raw-source backward compatibility.
      const result = spawnSync("python3", ["scripts/verify-course-workbenches.py"], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 600_000,
      });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("29 Browser Workbench contracts passed");
    },
    600_000,
  );
});
