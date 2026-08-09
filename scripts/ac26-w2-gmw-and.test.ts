import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-gmw-and");
const LOCAL = join(ROOT, "local");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function python(script: string) {
  return spawnSync("python3", ["-c", script], { cwd: LOCAL, encoding: "utf8" });
}

describe("ac26-w2-gmw-and: participant and author contract", () => {
  it("ships the shared make targets and one independently named exercise module", () => {
    const makefile = read("Makefile");
    for (const target of ["test:", "test-one:", "inspect:", "reset:", "reference-test:"]) {
      expect(makefile).toContain(target);
    }
    expect(read("local/starter/gmw.py")).toContain("def and_shared_bits");
    expect(read("local/starter/gmw.py")).toContain("ot_secrets.transfer(session, sender_party");
    expect(read("local/show.py")).toContain("session 0 is party 0 -> 1");
    expect(read("local/starter/gmw.py")).not.toContain("def gmw_and");
  });

  it("keeps the verifier loopback-only, bounded, healthy, and unprivileged", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("127.0.0.1:18123:18123");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("mem_limit: 1g");
    expect(compose).toContain("pids_limit: 128");
    expect(read("local/Dockerfile")).toContain("USER lab");
    expect(read("local/verifier/server.py")).toContain('HTTPServer(("0.0.0.0", port)');
  });

  it("derives different shares and masks from different seeds", () => {
    const result = python([
      "from fixtures.generate import gate_case",
      "print(gate_case(\"seed-a\",\"x\",1,1) != gate_case(\"seed-b\",\"x\",1,1))",
    ].join("\n"));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("True");
  });

  it("has a reachable reference and a failing starter for every checkpoint", () => {
    const result = python([
      "import json",
      "from pathlib import Path",
      "from verifier.server import CHECKPOINTS, evaluate",
      "reference = Path(\"reference/gmw.py\").read_text()",
      "starter = Path(\"starter/gmw.py\").read_text()",
      "print(json.dumps({\"reference\": {c: evaluate(c, reference) for c in CHECKPOINTS}, \"starter\": {c: evaluate(c, starter) for c in CHECKPOINTS}}))",
    ].join("\n"));
    expect(result.status).toBe(0);
    const verdict = JSON.parse(result.stdout);
    expect(Object.values(verdict.reference).every(Boolean)).toBe(true);
    expect(Object.values(verdict.starter).some(Boolean)).toBe(false);
  });

  it("measures seven final-output-blind mutations and kills every mutant", () => {
    const result = spawnSync("python3", ["mutation.py"], { cwd: LOCAL, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("FINAL-OUTPUT-BLIND 7 of 8");
    expect(result.stdout).toContain("All 9 mutations killed.");
  });

  it("rejects reconstruct-and-reshare although the complete truth table passes", () => {
    const result = python([
      "import types",
      "from tests.hidden import check_gmw",
      "source = \"\"\"def and_shared_bits(xs,ys,masks,ot):",
      "    x=xs[0]^xs[1]; y=ys[0]^ys[1]",
      "    return (masks[0], masks[0]^(x&y))",
      "\"\"\"",
      "m=types.ModuleType(\"open\"); exec(source,m.__dict__)",
      "print(not check_gmw.check_delivery(m,\"probe\"), bool(check_gmw.run(m,\"probe\")))",
    ].join("\n"));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("True True");
  });

  it("reuses main's published Week 2 sources and follows OT in the track", () => {
    const meta = JSON.parse(read("metadata.json"));
    expect(meta.track).toEqual({ id: "advanced-cryptography-2026", order: 270, chapter: "Week 2 / GMW Boolean AND" });
    expect(meta.courseAlignment.sources).toEqual([
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week2/README.md",
        kind: "lecture",
      },
      {
        repository: "zk-tokyo/advanced-cryptography-2026",
        ref: "a3aa4b56fa88fbe803b57d320fbc87c1a203b480",
        path: "week2/problems/toy-mpc/README.md",
        kind: "assignment",
      },
    ]);
    expect(meta.relations).toContainEqual({
      type: "requires",
      source: "problem.ac26-w2-gmw-and",
      target: "problem.ac26-w2-oblivious-transfer",
    });
    expect(meta.scoring.checks.reduce((sum: number, item: { points: number }) => sum + item.points, 0)).toBe(300);
  });

  it("echoes checkpointId and fails unknown ids closed", () => {
    expect(read("local/verifier/server.py")).toContain('{"checkpointId": checkpoint_id, "correct": correct}');
    const result = python("from verifier.server import evaluate; print(evaluate('unknown', 'x'))");
    expect(result.stdout.trim()).toBe("False");
  });
});
