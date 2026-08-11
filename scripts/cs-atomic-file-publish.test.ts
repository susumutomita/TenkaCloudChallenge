import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-atomic-file-publish");
const LOCAL = join(PROBLEM, "local");

function python(script: string, args: string[] = []): string {
  return execFileSync("python3", [script, ...args], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  });
}

function probe(source: string): string {
  return execFileSync("python3", ["-c", source], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  }).trim();
}

describe("cs-atomic-file-publish", () => {
  it("keeps the premise: the starter passes public tests and fails every hidden phase", () => {
    // The whole problem rests on this gap. If the starter ever fails a public test the
    // learner is told about the defect for free; if it ever passes a hidden phase there
    // is nothing left to discover.
    expect(python("tests/public/test_publish.py")).toContain("all passed");
    const failures = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import publish
from tests.hidden import check_publish as check
print(json.dumps({
  "publish": len(check.check_publish(publish, "repo-contract-seed")),
  "durable": len(check.check_durable(publish, "repo-contract-seed")),
  "generalize": len(check.check_generalize(publish, "repo-contract-seed")),
}))
`),
    ) as Record<string, number>;
    expect(Object.keys(failures).toSorted()).toEqual(["durable", "generalize", "publish"]);
    for (const count of Object.values(failures)) expect(count).toBeGreaterThan(0);
  });

  it("names the torn read explicitly, so the failure teaches rather than just fails", () => {
    const first = probe(`
import sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import publish
from tests.hidden import check_publish as check
print(check.check_publish(publish, "repo-contract-seed")[0])
`);
    expect(first).toContain("a reader could observe the destination");
  });

  it("passes the reference and kills every atomicity, durability and debris mutant", () => {
    const output = python("mutation.py");
    expect(output).toContain("reference: passes");
    expect(output).toContain("stages the work file in /tmp, where a rename is not atomic");
    expect(output).toContain("shares one fixed work-file name for every destination");
    expect(output).toContain("all 9 mutations killed");
    expect(output).not.toContain("SURVIVED");
  });

  it("holds the reference across deployments, so the answer is not seed-specific", () => {
    const results = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
from tests.hidden import check_publish as check
def load(name):
    spec = importlib.util.spec_from_file_location(name, "reference/publish.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
print(json.dumps({seed: len(check.run(load("r" + seed), seed)) for seed in ["seed-a", "seed-b", "seed-c"]}))
`),
    ) as Record<string, number>;
    for (const count of Object.values(results)) expect(count).toBe(0);
  });

  it("moves the audit answer with the seed, so it cannot be hard-coded", () => {
    const answers = JSON.parse(
      probe(`
import json, sys
sys.path.insert(0, ".")
from fixtures.generate import reader_observations
print(json.dumps({
  seed: [i for i, row in enumerate(reader_observations(seed)) if row.get("parsed") is False]
  for seed in ["deploy-a", "deploy-b", "deploy-e"]
}))
`),
    ) as Record<string, number[]>;
    const distinct = new Set(Object.values(answers).map((value) => value.join(",")));
    expect(distinct.size).toBeGreaterThan(1);
    for (const indexes of Object.values(answers)) expect(indexes.length).toBeGreaterThan(0);
  });

  it("grades the reference through the verifier and refuses the starter", () => {
    const verdicts = JSON.parse(
      probe(`
import importlib.util, json, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("verifier_server", "verifier/server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
reference = open("reference/publish.py", encoding="utf-8").read()
starter = open("starter/publish.py", encoding="utf-8").read()
print(json.dumps({
  "reference": [server.evaluate(name, reference) for name in ("publish", "durable", "generalize")],
  "starter": [server.evaluate(name, starter) for name in ("publish", "durable", "generalize")],
}))
`),
    ) as Record<string, boolean[]>;
    expect(verdicts.reference).toEqual([true, true, true]);
    expect(verdicts.starter).toEqual([false, false, false]);
  });

  it("keeps the answer and the hidden properties out of the participant image", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = (dockerfile.split("FROM base AS participant")[1] ?? "").split(
      "FROM base AS verifier",
    )[0] as string;
    for (const forbidden of ["reference/", "tests/hidden/", "mutation.py", "mutants/"]) {
      expect(participant).not.toContain(forbidden);
    }
    // The verifier grades; it must not carry the answer either.
    const verifier = (dockerfile.split("FROM base AS verifier")[1] ?? "").split(
      "FROM participant AS author",
    )[0] as string;
    expect(verifier).not.toContain("reference/");
    expect(verifier).not.toContain("mutation.py");
    expect(dockerfile).toContain("FROM participant AS author");
    expect(dockerfile).toContain("USER lab");
  });

  it("publishes only the Workbench on host loopback", () => {
    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    expect(compose).toContain('"127.0.0.1:18520:18520"');
    // The verifier's own healthcheck talks to 127.0.0.1:18521 *inside* its container,
    // which is fine. What must not exist is a published mapping for it: the assertion
    // is about `ports:` entries, not about the port number appearing anywhere.
    const published = [...compose.matchAll(/^\s+- "([\d.]+:\d+:\d+)"$/gm)].map((m) => m[1]);
    expect(published).toEqual(["127.0.0.1:18520:18520"]);
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("internal: true");
  });
});
