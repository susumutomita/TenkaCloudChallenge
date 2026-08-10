import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-async-result-binding");
const LOCAL = join(PROBLEM, "local");

function python(script: string, args: string[] = []) {
  return spawnSync("python3", [script, ...args], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-suite-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 120_000,
  });
}

describe("cs-async-result-binding deterministic harness", () => {
  it("keeps the shipped starter public-green and hidden-red in every phase", () => {
    const publicResult = python("tests/public/test_collect.py");
    expect(publicResult.stdout).toContain("public: PASS");
    expect(publicResult.status).toBe(0);

    for (const phase of ["check_overlap", "check_bind", "check_failure", "check_generalize"]) {
      const result = python("tests/hidden/check_collect.py", [
        "--module",
        "starter/collector.py",
        "--phase",
        phase,
      ]);
      expect(result.stdout, phase).toContain(`${phase}: FAIL`);
      expect(result.status, phase).not.toBe(0);
    }
  });

  it("passes the reference and kills all seven named mistake classes", () => {
    for (const phase of ["check_overlap", "check_bind", "check_failure", "check_generalize"]) {
      const result = python("tests/hidden/check_collect.py", [
        "--module",
        "reference/collector.py",
        "--phase",
        phase,
      ]);
      expect(result.stdout, phase).toContain(`${phase}: PASS`);
      expect(result.status, phase).toBe(0);
    }
    const result = python("mutation.py");
    expect(result.stdout).toContain("mutation: PASS — 7/7 killed");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  it("uses an explicit Future gate, not time, sockets, or accidental scheduler order", () => {
    const gate = readFileSync(join(LOCAL, "fixtures", "gate.py"), "utf8");
    const checker = readFileSync(join(LOCAL, "tests", "hidden", "check_collect.py"), "utf8");
    const fixtureSources = `${gate}\n${checker}`;
    expect(fixtureSources).toContain("future.set_result");
    expect(fixtureSources).toContain("future.set_exception");
    expect(fixtureSources).toContain("minimum_started");
    expect(fixtureSources).not.toContain("asyncio.sleep");
    expect(fixtureSources).not.toMatch(/(?:^|\n)\s*(?:import|from)\s+socket\b|socket\.|urlopen|requests\./);
    expect(fixtureSources).not.toMatch(/time\.(?:time|monotonic|sleep)/);
  });

  it("keeps Portal evidence answer-free and prepares only derived/code submissions", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from portal.server import config_payload, inspect_payload, prepare_submissions, starter_payload
from fixtures.generate import audit_answer
seed = "repo-suite-seed"
evidence = inspect_payload(seed)
prepared = prepare_submissions(seed, starter_payload())
metadata = json.load(open("../metadata.json", encoding="utf-8"))
config = config_payload()
print(json.dumps({
  "keys": sorted(evidence),
  "serialized": json.dumps(evidence, sort_keys=True),
  "answer": audit_answer(seed),
  "prepared": sorted(prepared["submissions"]),
  "starterFiles": sorted(starter_payload()),
  "configMatchesMetadata": (
    config["name"] == metadata["name"]
    and config["description"] == metadata["shortDescription"]
    and config["i18n"]["en"]["name"] == metadata["i18n"]["en"]["name"]
    and config["i18n"]["en"]["description"] == metadata["i18n"]["en"]["shortDescription"]
    and [item["id"] for item in config["checkpoints"]]
      == [item["id"] for item in metadata["scoring"]["checks"]]
    and [item["label"] for item in config["checkpoints"]]
      == [item["label"] for item in metadata["scoring"]["checks"]]
    and config["i18n"]["en"]["checkpointLabels"]
      == {item["id"]: item["label"] for item in metadata["i18n"]["en"]["checks"]}
  ),
}))
`;
    const result = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const report = JSON.parse(result) as {
      keys: string[];
      serialized: string;
      answer: number[];
      prepared: string[];
      starterFiles: string[];
      configMatchesMetadata: boolean;
    };
    expect(report.keys).toEqual(["audit", "environment"]);
    expect(report.serialized).not.toContain('"wrong"');
    expect(report.serialized).not.toContain('"auditAnswer"');
    expect(report.answer.length).toBeGreaterThan(1);
    expect(report.prepared).toEqual(["bind", "environment", "failure", "generalize", "overlap"]);
    expect(report.starterFiles).toEqual(["collector.py"]);
    expect(report.configMatchesMetadata).toBe(true);
  });

  it("does not let learner atexit output replace the verifier verdict", () => {
    const probe = String.raw`
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = 'import atexit, json, os\natexit.register(lambda: (print(json.dumps({"failures": []})), os._exit(0)))\n'
reference = open("reference/collector.py", encoding="utf-8").read()
print(server._check_code("bind", spoof), server._check_code("bind", reference))
`;
    const result = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-suite-seed", PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(result.trim()).toBe("False True");
  });

  it("does not expose hidden checker modules to participant imports", () => {
    const probe = String.raw`
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
from tests.hidden import check_collect
async def bypass(*_): return True, "passed"
check_collect.evaluate_module = bypass
async def collect(*_): return []
'''
reference = open("reference/collector.py", encoding="utf-8").read()
print(server._check_code("bind", spoof), server._check_code("bind", reference))
`;
    const result = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-suite-seed", PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(result.trim()).toBe("False True");
  });

  it("does not let learner imports replace verdict serialization or hard exit", () => {
    const probe = String.raw`
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
import json, os
json.dumps = lambda *_args, **_kwargs: '{"failures": []}'
os._exit = lambda _code: os.write(1, b'{"failures": []}\\n')
async def collect(jobs, start_io):
    futures = [start_io(job) for job in jobs]
    values = [await future for future in reversed(futures)]
    return [
        {"jobId": job["id"], "ok": True, "value": value}
        for job, value in zip(jobs, values)
    ]
'''
reference = open("reference/collector.py", encoding="utf-8").read()
print(server._check_code("bind", spoof), server._check_code("bind", reference))
`;
    const result = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-suite-seed", PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(result.trim()).toBe("False True");
  }, 30_000);

  it("derives the failed job, completion order, and message from the seed", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from tests.hidden.check_collect import failure_cases
def shape(seed):
    cases = failure_cases(seed)
    return {
        "positions": [next(index for index, job in enumerate(case.jobs) if job["id"] in case.failures) for case in cases],
        "groups": [case.completion_groups for case in cases],
        "messages": [sorted(case.failures.values()) for case in cases],
    }
print(json.dumps([shape("failure-seed-a"), shape("failure-seed-b")]))
`;
    const result = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const [first, second] = JSON.parse(result) as Array<{ positions: number[] }>;
    expect(first.positions).toHaveLength(3);
    expect(new Set(first.positions).size).toBe(3);
    expect(second.positions).toHaveLength(3);
    expect(new Set(second.positions).size).toBe(3);
    expect(first).not.toEqual(second);
  });
});

describe("cs-async-result-binding delivery boundary", () => {
  it("declares the six Issue 427 checkpoints and exactly 200 points", () => {
    const metadata = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      status: string;
      track: { id: string; order: number; chapter: string };
      scoring: { kind: string; checks: Array<{ id: string; points: number }> };
      i18n: { en: { checks: Array<{ id: string }> } };
      runtime: { challengeEndpoints: Record<string, string>; verifyUrl: string };
    };
    const ids = ["environment", "audit", "overlap", "bind", "failure", "generalize"];
    expect(metadata.status).toBe("draft");
    expect(metadata.track).toEqual({ id: "cs-foundations", order: 30, chapter: "3. I/Oと並行性" });
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.map((item) => item.id)).toEqual(ids);
    expect(metadata.i18n.en.checks.map((item) => item.id)).toEqual(ids);
    expect(metadata.scoring.checks.reduce((sum, item) => sum + item.points, 0)).toBe(200);
    expect(metadata.runtime.challengeEndpoints).toEqual({
      "Participant Portal editor API": "http://127.0.0.1:18330/",
    });
    expect(metadata.runtime.verifyUrl).toBe("http://127.0.0.1:18330/verify");
  });

  it("keeps participant, verifier, and author materials in explicit disjoint targets", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = dockerfile.split("FROM base AS participant", 2)[1]?.split("FROM base AS verifier", 1)[0] ?? "";
    const verifier = dockerfile.split("FROM base AS verifier", 2)[1]?.split("FROM participant AS author", 1)[0] ?? "";
    expect(participant).toContain("tests/public/");
    expect(participant).toContain("portal/");
    expect(participant).not.toContain("tests/hidden/");
    expect(participant).not.toContain("reference/");
    expect(participant).not.toContain("mutation.py");
    expect(participant).not.toContain("verifier/");
    expect(verifier).toContain("tests/hidden/");
    expect(verifier).not.toContain("tests/public/");
    expect(verifier).not.toContain("starter/");
    expect(verifier).not.toContain("reference/");
    expect(verifier).not.toContain("mutation.py");
    expect(dockerfile).toContain("FROM participant AS author");
    expect(dockerfile).toContain("COPY --chown=lab:lab tests/hidden/ ./tests/hidden/");
    expect(dockerfile).toContain("COPY --chown=lab:lab reference/ ./reference/");
  });

  it("runs non-root/read-only on loopback and retains inbound reachability without egress", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("RUN useradd --create-home --uid 10001 lab");
    expect(dockerfile.match(/USER lab/g)?.length).toBeGreaterThanOrEqual(3);

    const source = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    expect(source).toMatch(/^  participant:/m);
    expect(source).toMatch(/^  verifier:/m);
    expect(source.match(/read_only: true/g)).toHaveLength(2);
    expect(source.match(/cap_drop:/g)).toHaveLength(2);
    expect(source.match(/healthcheck:/g)).toHaveLength(2);
    expect(source).toContain('"127.0.0.1:18330:8080"');
    expect(source).not.toContain('"127.0.0.1:18331:8081"');
    expect(source).toContain("VERIFIER_URL: http://verifier:8081/verify");
    expect(source.match(/internal: true/g)).toHaveLength(1);
    expect(source.match(/com\.docker\.network\.bridge\.enable_ip_masquerade: "false"/g)).toHaveLength(1);
    expect(source).toContain("- lab");
    expect(source).toContain("- participant-host");

    const portal = readFileSync(join(LOCAL, "portal", "server.py"), "utf8");
    expect(portal).toContain('elif path == "/verify" and VERIFIER_URL:');
    expect(portal).toContain('verdict.get("checkpointId") != checkpoint');
    expect(portal).toContain('type(verdict.get("correct")) is not bool');
  });

  it("registers curriculum order, solvability mirror, diagram, and generated catalog entry", () => {
    expect(readFileSync(join(ROOT, "docs", "curricula", "cs-foundations", "curriculum.md"), "utf8")).toContain(
      "| 30 | `cs-async-result-binding` |",
    );
    expect(existsSync(join(ROOT, "scripts", "solvability", "expected", "cs-async-result-binding.py"))).toBe(true);
    expect(readFileSync(join(PROBLEM, "diagram.svg"), "utf8").startsWith("<svg")).toBe(true);
    expect(readFileSync(join(ROOT, "index.json"), "utf8")).toContain('"id": "cs-async-result-binding"');
  });
});
