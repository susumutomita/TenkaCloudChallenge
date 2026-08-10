import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-transaction-visibility-audit");
const LOCAL = join(PROBLEM, "local");

function python(script: string, args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync("python3", [script, ...args], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "transaction-repo-suite-seed",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 120_000,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("cs-transaction-visibility-audit の契約", () => {
  it("は 200 点を 35 / 35 / 80 / 50 の 4 checkpoint に分ける", () => {
    const metadata = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      track: { id: string; order: number; chapter: string };
      exposedPorts: Array<{ port: number }>;
      scoring: { kind: string; checks: Array<{ id: string; points: number }> };
    };
    expect(metadata.track).toEqual({
      id: "cs-foundations",
      order: 20,
      chapter: "2. トランザクションと可視性",
    });
    expect(metadata.exposedPorts.map((entry) => entry.port)).toEqual([18320]);
    expect(metadata.scoring.kind).toBe("multi-verify");
    expect(metadata.scoring.checks.map(({ id, points }) => [id, points])).toEqual([
      ["audit", 35],
      ["counterexample", 35],
      ["snapshot", 80],
      ["transfer", 50],
    ]);
    expect(metadata.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(200);
  });

  it("は commit が read 間に無い公開テストを starter のまま通す", () => {
    const result = python("tests/public/test_report.py");
    expect(result.output).toContain("public tests: all passed");
    expect(result.output).toContain("no commit between row reads");
    expect(result.status).toBe(0);
  });

  it("は reference を通し、starter を hidden の両 phase で落とす", () => {
    const probe = String.raw`
import importlib.util, json, sys
from pathlib import Path
sys.path.insert(0, ".")
from tests.hidden import check_report
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, Path(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
starter = load("starter_report", "starter/report.py")
reference = load("reference_report", "reference/report.py")
seed = "transaction-repo-suite-seed"
print(json.dumps({
    "starterSnapshot": len(check_report.check_snapshot(starter, seed)),
    "starterTransfer": len(check_report.check_transfer(starter, seed)),
    "referenceSnapshot": check_report.check_snapshot(reference, seed),
    "referenceTransfer": check_report.check_transfer(reference, seed),
}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    const result = JSON.parse(output.trim()) as {
      starterSnapshot: number;
      starterTransfer: number;
      referenceSnapshot: string[];
      referenceTransfer: string[];
    };
    expect(result.starterSnapshot).toBeGreaterThan(0);
    expect(result.starterTransfer).toBeGreaterThan(0);
    expect(result.referenceSnapshot).toEqual([]);
    expect(result.referenceTransfer).toEqual([]);
  });

  it("は participant から hidden checker を差し替えられない", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
from tests.hidden import check_report
check_report.check_snapshot = lambda *_: []
def build_report(*_):
    return {"revision": 0, "balances": {}, "total": 0}
'''
print(json.dumps({"accepted": server._run_submission(spoof, ("check_snapshot",), server.SEED)}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "transaction-repo-suite-seed",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 120_000,
    });
    expect(JSON.parse(output.trim())).toEqual({ accepted: false });
  });

  it("は participant に verdict の serializer と hard exit を差し替えられても fail closed する", () => {
    const probe = String.raw`
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
import json, os
json.dumps = lambda *_args, **_kwargs: '{"failures": []}'
os._exit = lambda _code: os.write(1, b'{"failures": []}\\n')
def build_report(*_):
    return {"revision": 0, "balances": {}, "total": 0}
'''
reference = open("reference/report.py", encoding="utf-8").read()
print(server._run_submission(spoof, ("check_snapshot",), server.SEED), server._run_submission(reference, ("check_snapshot",), server.SEED))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "transaction-repo-suite-seed",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 120_000,
    });
    expect(output.trim()).toBe("False True");
  });

  it("は指定された欠陥、writer freeze、TTL wait、pre-commit invalidate を殺す", () => {
    const result = python("mutation.py");
    expect(result.output).toContain("reference: passes");
    for (const mutation of [
      "latest-per-row",
      "snapshot-per-row",
      "snapshot-after-first-row",
      "snapshot-then-live-reads",
      "wrong-report-revision",
      "hardcoded-public-total",
      "refuse-when-a-commit-is-scheduled",
      "hardcoded-public-account-ids",
      "reader-wide-writer-freeze",
      "ttl-wait [check_snapshot]",
      "pre-commit-invalidate [check_snapshot]",
    ]) {
      expect(result.output).toContain(`killed  ${mutation}`);
    }
    expect(result.output).toContain("all 11 mutations killed");
    expect(result.output).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  it("は direct answer を seed 由来にし、Portal prepare で seal する", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server as participant_server
from verifier import server
seed = server.SEED
other = seed + ":other"
source = participant_server._WORKBENCH.starter_payload()
manual = {
    "audit": json.dumps(server.audit_expected(seed)),
    "counterexample": json.dumps(server.counterexample_expected(seed)),
}
prepared = participant_server._WORKBENCH.prepare_submissions(source, manual)
unwrapped = {
    checkpoint: server._unwrap_submission(checkpoint, value)
    for checkpoint, value in prepared["submissions"].items()
}
print(json.dumps({
    "config": participant_server._WORKBENCH.config_payload(),
    "prepared": prepared,
    "sameAccepted": {
        "audit": server.evaluate("audit", unwrapped["audit"]),
        "counterexample": server.evaluate("counterexample", unwrapped["counterexample"]),
    },
    "otherAccepted": {
        "audit": server.evaluate("audit", server.audit_expected(other)),
        "counterexample": server.evaluate("counterexample", server.counterexample_expected(other)),
    },
    "sealedCode": all(str(prepared["submissions"][cp]).startswith("tcw1.") for cp in ("snapshot", "transfer")),
}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "transaction-repo-suite-seed",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 120_000,
    });
    const result = JSON.parse(output.trim()) as {
      config: {
        checkpoints: Array<{ id: string; kind: string }>;
        i18n: { en: { checkpointLabels: Record<string, string> } };
      };
      prepared: { ok: boolean; submissions: Record<string, string>; missingManual: string[] };
      sameAccepted: Record<string, boolean>;
      otherAccepted: Record<string, boolean>;
      sealedCode: boolean;
    };
    expect(result.config.checkpoints).toEqual([
      { id: "audit", label: expect.any(String), kind: "answer" },
      { id: "counterexample", label: expect.any(String), kind: "answer" },
      { id: "snapshot", label: expect.any(String), kind: "code" },
      { id: "transfer", label: expect.any(String), kind: "code" },
    ]);
    expect(Object.keys(result.config.i18n.en.checkpointLabels).toSorted()).toEqual([
      "audit",
      "counterexample",
      "snapshot",
      "transfer",
    ]);
    expect(result.prepared.ok).toBe(true);
    expect(Object.keys(result.prepared.submissions).toSorted()).toEqual([
      "audit",
      "counterexample",
      "snapshot",
      "transfer",
    ]);
    expect(result.prepared.missingManual).toEqual([]);
    expect(result.sameAccepted).toEqual({ audit: true, counterexample: true });
    expect(result.otherAccepted).toEqual({ audit: false, counterexample: false });
    expect(result.sealedCode).toBe(true);
  });

  it("は verifier URL 未設定・内部障害を全 checkpoint で fail closed する", () => {
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from participant import server
bodies = [{"checkpointId": checkpoint, "submission": "anything"} for checkpoint in server.CHECKPOINTS]
print(json.dumps({
    "missing": [server.proxy_verdict(body, "") for body in bodies],
    "unavailable": [server.proxy_verdict(body, "http://127.0.0.1:1/verify") for body in bodies],
    "hasInlineEvaluator": hasattr(server, "evaluate") or hasattr(server, "audit_expected"),
}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: "transaction-repo-suite-seed",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      timeout: 120_000,
    });
    const result = JSON.parse(output.trim()) as {
      missing: Array<{ checkpointId: string; correct: boolean }>;
      unavailable: Array<{ checkpointId: string; correct: boolean }>;
      hasInlineEvaluator: boolean;
    };
    const expected = ["audit", "counterexample", "snapshot", "transfer"].map(
      (checkpointId) => ({ checkpointId, correct: false }),
    );
    expect(result.missing).toEqual(expected);
    expect(result.unavailable).toEqual(expected);
    expect(result.hasInlineEvaluator).toBe(false);
  });

  it("は real thread / timing / network に依存しない", () => {
    const sources = [
      "fixtures/generate.py",
      "starter/report.py",
      "reference/report.py",
      "tests/public/test_report.py",
      "tests/hidden/check_report.py",
      "mutation.py",
    ].map((path) => readFileSync(join(LOCAL, path), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(/^\s*(?:from|import)\s+(?:threading|socket|asyncio|time)\b/m);
      expect(source).not.toContain("sleep(");
    }
  });

  it("は participant Workbench と hidden verifier を分離し、runtime を harden する", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participant).not.toContain("tests/hidden");
    expect(participant).not.toContain("COPY --chown=lab:lab verifier/");
    expect(participant).not.toContain("COPY --chown=lab:lab reference/");
    expect(participant).not.toContain("COPY --chown=lab:lab mutation.py");
    expect(participant).toContain("COPY --chown=lab:lab tests/public/");
    expect(participant).toContain("COPY --chown=lab:lab participant/");
    const verifier = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifier).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifier).toContain("COPY --chown=lab:lab verifier/");
    expect(verifier).not.toContain("COPY --chown=lab:lab participant/");
    expect(verifier).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifier).not.toContain("COPY --chown=lab:lab mutation.py");
    expect(dockerfile).toContain("USER lab");
    expect(dockerfile).toContain("COPY --chown=lab:lab verifier/ ./verifier/");
    expect(dockerfile).toContain("COPY --chown=lab:lab reference/ ./reference/");

    const participantServer = readFileSync(join(LOCAL, "participant", "server.py"), "utf8");
    const participantSupport = readFileSync(join(LOCAL, "participant", "workbench.py"), "utf8");
    const publicFixtures = readFileSync(join(LOCAL, "fixtures", "generate.py"), "utf8");
    const hiddenServer = readFileSync(join(LOCAL, "verifier", "server.py"), "utf8");
    for (const source of [participantServer, participantSupport, publicFixtures]) {
      expect(source).not.toContain("tests.hidden");
      expect(source).not.toContain("def audit_expected");
      expect(source).not.toContain("def counterexample_expected");
    }
    for (const answerField of ["badReportId", "badObservedRevisions", "crossingTransferId"]) {
      expect(publicFixtures).not.toContain(answerField);
    }
    expect(publicFixtures).not.toContain("def snapshot_cases");
    expect(publicFixtures).not.toContain("def transfer_cases");
    expect(participantServer).not.toContain("def evaluate(");
    expect(participantServer).not.toContain("from verifier");
    expect(hiddenServer).not.toContain("/api/config");
    expect(hiddenServer).not.toContain("/api/inspect");
    expect(hiddenServer).toContain("from verifier.expected import");
    expect(hiddenServer).toContain("from tests.hidden import check_report");

    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    for (const contract of [
      "target: participant",
      "target: verifier",
      '127.0.0.1:18320:18320',
      "VERIFIER_URL: http://verifier:18321/verify",
      "read_only: true",
      "cap_drop:",
      "- ALL",
      "no-new-privileges:true",
      "healthcheck:",
      "internal: true",
      'com.docker.network.bridge.enable_ip_masquerade: "false"',
    ]) {
      expect(compose).toContain(contract);
    }
    expect(compose).not.toContain('"127.0.0.1:18321:18321"');
    expect(compose.match(/ports:/g)).toHaveLength(1);
  });

  it("は Portal の 5 API と cs-foundations order 20 の教材導線を持つ", () => {
    const server = readFileSync(join(LOCAL, "participant", "server.py"), "utf8");
    for (const endpoint of ["/api/config", "/api/starter", "/api/inspect", "/api/test", "/api/prepare", "/verify"]) {
      expect(server).toContain(endpoint);
    }
    const curriculum = readFileSync(
      join(ROOT, "docs", "curricula", "cs-foundations", "curriculum.md"),
      "utf8",
    );
    expect(curriculum).toContain("| 20 | `cs-transaction-visibility-audit` | d3 |");
  });
});
