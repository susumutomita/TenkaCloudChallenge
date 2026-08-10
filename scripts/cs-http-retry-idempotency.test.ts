import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-http-retry-idempotency");
const LOCAL = join(PROBLEM, "local");

function python(script: string, args: string[] = []): string {
  return execFileSync("python3", [script, ...args], {
    cwd: LOCAL,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  });
}

describe("cs-http-retry-idempotency", () => {
  it("keeps the premise: the starter passes public tests and fails every hidden phase", () => {
    expect(python("tests/public/test_idempotency.py")).toContain("all passed");
    const probe = `
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import idempotency
from tests.hidden import check_idempotency as check
print(json.dumps({
  "replay": len(check.check_replay(idempotency, "repo-contract-seed")),
  "bind": len(check.check_bind(idempotency, "repo-contract-seed")),
  "generalize": len(check.check_generalize(idempotency, "repo-contract-seed")),
}))
`;
    const failures = JSON.parse(
      execFileSync("python3", ["-c", probe], {
        cwd: LOCAL,
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 120_000,
      }).trim(),
    ) as Record<string, number>;
    expect(Object.keys(failures).toSorted()).toEqual(["bind", "generalize", "replay"]);
    for (const count of Object.values(failures)) expect(count).toBeGreaterThan(0);
  });

  it("passes the reference and kills durable, binding, replay, race, and validation mutants", () => {
    const output = python("mutation.py");
    expect(output).toContain("reference: passes");
    expect(output).toContain("all 7 mutations killed");
    expect(output).not.toContain("SURVIVED");
  });

  it("shows commit before response drop and varies the audit answer by seed", () => {
    const probe = `
import json
from fixtures.generate import audit_log, dropped_response_trace
trace = dropped_response_trace("repo-contract-seed")[0]["events"]
answers = []
for index in range(100):
    rows = audit_log(f"seed-{index}")
    answers.append([row_index for row_index, row in enumerate(rows) if row["attempt"] == 2])
print(json.dumps({"trace": trace, "answers": answers}))
`;
    const evidence = JSON.parse(
      execFileSync("python3", ["-c", probe], { cwd: LOCAL, encoding: "utf8" }).trim(),
    ) as { trace: unknown[]; answers: number[][] };
    expect(JSON.stringify(evidence.trace[1])).toContain("ledger_committed");
    expect(evidence.trace[2]).toBe("response_dropped_before_client_received_it");
    expect(new Set(evidence.answers.map(JSON.stringify)).size).toBeGreaterThanOrEqual(5);
  });

  it("derives every hidden operation field from the verifier seed", () => {
    const probe = `
import json
from tests.hidden.check_idempotency import _operation
labels = (
    "replay-checkpoint:replay",
    "bind-checkpoint:replay",
    "bind-checkpoint:binding",
    "bind-checkpoint:validation-recovery",
    "generalize-checkpoint:replay",
    "generalize-checkpoint:binding",
    "generalize-checkpoint:validation-recovery",
    "generalize-checkpoint:concurrent",
    "generalize-checkpoint:restart",
)
seeds = [f"grading-seed-{index}" for index in range(32)]
distinct = {}
for label in labels:
    cases = [_operation(seed, label) for seed in seeds]
    distinct[label] = {
        "keys": len({key for key, _request in cases}),
        "accounts": len({request["account"] for _key, request in cases}),
        "amounts": len({request["amount"] for _key, request in cases}),
        "memos": len({request["memo"] for _key, request in cases}),
    }
samples = [_operation("same-grading-seed", label) for label in labels]
print(json.dumps({"distinct": distinct, "samples": samples}))
`;
    const evidence = JSON.parse(
      execFileSync("python3", ["-c", probe], { cwd: LOCAL, encoding: "utf8" }).trim(),
    ) as { distinct: Record<string, Record<string, number>>; samples: unknown[] };
    for (const phase of Object.values(evidence.distinct)) {
      for (const distinct of Object.values(phase)) expect(distinct).toBeGreaterThan(1);
    }
    const oneSeed = evidence.samples.map(JSON.stringify);
    expect(new Set(oneSeed).size).toBe(oneSeed.length);
  });

  it("does not expose hidden checker modules to participant imports", () => {
    const probe = `
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
from tests.hidden import check_idempotency
check_idempotency.check_replay = lambda *_: []
def handle_request(*_): return {"status": 500, "body": {}}
'''
reference = open("reference/idempotency.py", encoding="utf-8").read()
print(server._check_code("check_replay", spoof), server._check_code("check_replay", reference))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    expect(output.trim()).toBe("False True");
  });

  it("does not let participant imports replace verdict serialization or hard exit", () => {
    const probe = `
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
import json, os
json.dumps = lambda *_args, **_kwargs: '{"failures": []}'
os._exit = lambda _code: os.write(1, b'{"failures": []}\\n')
def handle_request(*_args, **_kwargs):
    return {"status": 500, "body": {}}
'''
reference = open("reference/idempotency.py", encoding="utf-8").read()
print(server._check_code("check_replay", spoof), server._check_code("check_replay", reference))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-contract-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    expect(output.trim()).toBe("False True");
  });

  it("separates participant Workbench, hidden verifier, and author artifacts", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participantFixtures = readFileSync(join(LOCAL, "fixtures", "generate.py"), "utf8");
    const participant = (dockerfile.split("FROM base AS participant")[1] ?? "").split(
      "FROM base AS verifier",
    )[0];
    const verifier = (dockerfile.split("FROM base AS verifier")[1] ?? "").split(
      "FROM participant AS author",
    )[0];
    expect(participant).not.toContain("tests/hidden");
    expect(participant).not.toContain("reference/");
    expect(participant).not.toContain("mutation.py");
    expect(verifier).toContain("tests/hidden/");
    expect(verifier).not.toContain("reference/");
    expect(verifier).not.toContain("mutation.py");
    expect(participantFixtures).not.toContain("def uncertain_answer");
    expect(participantFixtures).not.toContain("def audit_answer");
    expect(dockerfile).toContain("FROM participant AS author");
    expect(dockerfile).toContain("USER lab");
  });

  it("publishes only loopback 18350 and runs read-only without an outbound-masqueraded network", () => {
    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    const verifier = readFileSync(join(LOCAL, "verifier", "server.py"), "utf8");
    expect(compose).toContain('"127.0.0.1:18350:18350"');
    expect(compose).not.toContain("18351:18351");
    expect(compose.match(/read_only: true/g)?.length).toBe(2);
    expect(compose.match(/cap_drop:/g)?.length).toBe(2);
    expect(compose).toContain("internal: true");
    expect(compose).toContain('com.docker.network.bridge.enable_ip_masquerade: "false"');
    expect(compose).toContain("target: participant");
    expect(compose).toContain("target: verifier");
    expect(compose).toContain("healthcheck:");
    expect(compose.match(/pids_limit: 96/g)).toHaveLength(2);
    expect(verifier).toContain("MAX_PROCESSES = 128");
    expect(verifier).toContain("baseline + MAX_PROCESSES");
  });

  it("adds submission headroom to the shared Linux uid baseline", () => {
    const probe = `
import resource, sys
sys.path.insert(0, ".")
from verifier import server
server._uid_task_count = lambda: 240
original = resource.getrlimit
resource.getrlimit = lambda _kind: (resource.RLIM_INFINITY, resource.RLIM_INFINITY)
try:
    print(server._nproc_limit())
finally:
    resource.getrlimit = original
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(output.trim()).toBe("368");
  });

  it("accepts valid concurrency when the shared Linux uid already owns 129 threads", () => {
    const probe = `
import os, subprocess, sys
if not sys.platform.startswith("linux") or os.geteuid() == 0:
    print(True)
    raise SystemExit(0)
sys.path.insert(0, ".")
from verifier import server
helper_source = r'''
import threading
threading.stack_size(64 * 1024)
stop = threading.Event()
threads = [threading.Thread(target=stop.wait, daemon=True) for _ in range(129)]
for thread in threads:
    thread.start()
print("ready", flush=True)
stop.wait(30)
'''
helper = subprocess.Popen(
    [sys.executable, "-c", helper_source],
    stdout=subprocess.PIPE,
    text=True,
)
try:
    assert helper.stdout is not None and helper.stdout.readline().strip() == "ready"
    reference = open("reference/idempotency.py", encoding="utf-8").read()
    print(server._check_code("check_generalize", reference))
finally:
    helper.terminate()
    helper.wait(timeout=5)
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "shared-uid-regression",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 120_000,
    });
    expect(output.trim()).toBe("True");
  });

  it("ships six checkpoints worth 200 points at curriculum order 50", () => {
    const metadata = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      track: { id: string; order: number; chapter: string };
      scoring: { kind: string; checks: Array<{ id: string; points: number }> };
      i18n: { en: { checks: Array<{ id: string }> } };
      runtime: { verifyUrl: string };
    };
    expect(metadata.track).toEqual({
      id: "cs-foundations",
      order: 50,
      chapter: "5. HTTP再送と冪等性",
    });
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.reduce((sum, item) => sum + item.points, 0)).toBe(200);
    expect(metadata.scoring.checks.map((item) => item.id)).toEqual(
      metadata.i18n.en.checks.map((item) => item.id),
    );
    expect(metadata.runtime.verifyUrl).toBe("http://127.0.0.1:18350/verify");
  });

  it("states the guarantee without claiming exactly-once transport", () => {
    for (const filename of ["README.md", "README.ja.md"]) {
      const text = readFileSync(join(PROBLEM, filename), "utf8");
      expect(text).toContain("at-most-once");
      expect(text).toContain("exactly-once transport");
      expect(text.toLowerCase()).toMatch(/not exactly-once|exactly-once transportではない|exactly onceにしたのではない/);
    }
  });
});
