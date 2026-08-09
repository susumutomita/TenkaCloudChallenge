import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w2-oblivious-transfer");
const LOCAL = join(ROOT, "local");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function python(script: string) {
  return spawnSync("python3", ["-c", script], { cwd: LOCAL, encoding: "utf8" });
}

describe("ac26-w2-oblivious-transfer: participant and author contract", () => {
  it("ships the shared make targets and only the intended exercise module", () => {
    const makefile = read("Makefile");
    for (const target of ["test:", "test-one:", "inspect:", "reset:", "reference-test:"]) {
      expect(makefile).toContain(target);
    }
    expect(read("local/starter/ot.py")).toContain("def make_receiver_request");
    expect(read("local/starter/ot.py")).toContain('f"tc-ot-v1:{shared}:{branch}"');
    expect(read("local/show.py")).toContain("ciphertext_i = message_i XOR pad");
    expect(read("local/starter/ot.py")).not.toContain("ot_receiver_request");
    expect(read("local/reference/ot.py")).not.toContain("ot_sender_encrypt");
  });

  it("keeps the verifier loopback-only, bounded, healthy, and unprivileged", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("127.0.0.1:18122:18122");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("mem_limit: 1g");
    expect(compose).toContain("pids_limit: 128");
    expect(read("local/Dockerfile")).toContain("USER lab");
    expect(read("local/verifier/server.py")).toContain('HTTPServer(("0.0.0.0", port)');
  });

  it("derives different fixtures from different seeds", () => {
    const result = python([
      "from fixtures.generate import case",
      "print(case(\"seed-a\", \"x\", 0) != case(\"seed-b\", \"x\", 0))",
    ].join("\n"));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("True");
  });

  it("has a reachable reference and a failing starter for every checkpoint", () => {
    const result = python([
      "import json",
      "from pathlib import Path",
      "from verifier.server import CHECKPOINTS, evaluate",
      "reference = Path(\"reference/ot.py\").read_text()",
      "starter = Path(\"starter/ot.py\").read_text()",
      "print(json.dumps({\"reference\": {c: evaluate(c, reference) for c in CHECKPOINTS}, \"starter\": {c: evaluate(c, starter) for c in CHECKPOINTS}}))",
    ].join("\n"));
    expect(result.status).toBe(0);
    const verdict = JSON.parse(result.stdout);
    expect(Object.values(verdict.reference).every(Boolean)).toBe(true);
    expect(Object.values(verdict.starter).some(Boolean)).toBe(false);
  });

  it("measures six final-output-blind mutations and kills every mutant", () => {
    const result = spawnSync("python3", ["mutation.py"], { cwd: LOCAL, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("FINAL-OUTPUT-BLIND 6 of 8");
    expect(result.stdout).toContain("All 9 mutations killed.");
  });

  it("rejects a cleartext protocol although its final delivery is correct", () => {
    const result = python([
      "import types",
      "from tests.hidden import check_ot",
      "source = \"\"\"def make_receiver_request(a,c,b): return c",
      "def seal_sender_messages(a,r,m0,m1): return (m0,m1)",
      "def open_receiver_message(a,c,b,cts): return cts[c]",
      "\"\"\"",
      "m=types.ModuleType(\"clear\"); exec(source,m.__dict__)",
      "print(not check_ot.check_delivery(m,\"probe\"), bool(check_ot.run(m,\"probe\")))",
    ].join("\n"));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("True True");
  });

  it("reuses main's published Week 2 sources and totals 300 points", () => {
    const meta = JSON.parse(read("metadata.json"));
    expect(meta.track).toEqual({ id: "advanced-cryptography-2026", order: 240, chapter: "Week 2 / Oblivious Transfer" });
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
    expect(meta.scoring.checks.reduce((sum: number, item: { points: number }) => sum + item.points, 0)).toBe(300);
    expect(meta.i18n.en.checks).toHaveLength(meta.scoring.checks.length);
  });

  it("echoes checkpointId and fails unknown ids closed", () => {
    expect(read("local/verifier/server.py")).toContain('{"checkpointId": checkpoint_id, "correct": correct}');
    const result = python("from verifier.server import evaluate; print(evaluate('unknown', 'x'))");
    expect(result.stdout.trim()).toBe("False");
  });
});
