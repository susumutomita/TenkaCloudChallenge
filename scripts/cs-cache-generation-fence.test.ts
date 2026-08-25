import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-cache-generation-fence");
const LOCAL = join(PROBLEM, "local");

function python(script: string, args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync("python3", [script, ...args], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-cache-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("cs-cache-generation-fence harness", () => {
  it("kills every cache-policy mutation", () => {
    const result = python("mutation.py");
    expect(result.output).toContain("reference: passes");
    expect(result.output).toContain("waits for a TTL and then admits the stale fill at fence");
    expect(result.output).toContain(
      "invalidates before commit and guesses the next revision from cache at basic-invalidate",
    );
    expect(result.output).toContain("killed: 12/12");
    expect(result.output).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  it("keeps the public suite green for the broken starter", () => {
    const result = python("tests/public/test_cache_policy.py");
    expect(result.output).toContain("all passed (3)");
    expect(result.status).toBe(0);
  });

  it("rejects the starter in every code checkpoint", () => {
    const probe = `
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import cache_policy
from tests.hidden import check_cache_policy as chk
print(json.dumps({
    "basic": len(chk.check_basic_invalidate(cache_policy, "repo-cache-seed")),
    "fence": len(chk.check_fence(cache_policy, "repo-cache-seed")),
    "perKey": len(chk.check_per_key(cache_policy, "repo-cache-seed")),
    "generalize": len(chk.check_generalize(cache_policy, "repo-cache-seed")),
}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const failures = JSON.parse(output.trim()) as Record<string, number>;
    for (const [phase, count] of Object.entries(failures)) {
      expect(count, `${phase} accepted the starter`).toBeGreaterThan(0);
    }
  });

  it("does not expose hidden checker modules to participant imports", () => {
    const probe = `
import sys
sys.path.insert(0, ".")
from verifier import server
spoof = '''
from tests.hidden import check_cache_policy
check_cache_policy.check_fence = lambda *_: []
def invalidate(*_): pass
def admit_fill(*_): return True
'''
reference = open("reference/cache_policy.py", encoding="utf-8").read()
print(server._check_code("check_fence", spoof), server._check_code("check_fence", reference))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-cache-seed", PYTHONDONTWRITEBYTECODE: "1" },
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
def invalidate(cache, key, committed_revision):
    cache["entries"].pop(key, None)
def admit_fill(cache, key, value, revision):
    cache["entries"][key] = {"value": value, "revision": revision}
    return True
'''
reference = open("reference/cache_policy.py", encoding="utf-8").read()
print(server._check_code("check_fence", spoof), server._check_code("check_fence", reference))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-cache-seed", PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(output.trim()).toBe("False True");
  });

  it("serves the exact Portal editor contract and prepares every automatic submission", () => {
    const probe = `
import json, sys
sys.path.insert(0, ".")
from verifier.server import CHECKPOINTS as VERIFIER_CHECKPOINTS
from participant.server import CHECKPOINTS, CODE_CHECKPOINTS, config_payload, prepare_submissions, starter_payload
starter = starter_payload()
config = config_payload()
prepared = prepare_submissions("repo-cache-seed", starter)
print(json.dumps({
    "id": config["id"],
    "files": config["submittedFiles"],
    "checkpoints": [item["id"] for item in config["checkpoints"]],
    "kinds": {item["id"]: item["kind"] for item in config["checkpoints"]},
    "prepared": sorted(prepared["submissions"]),
    "automatic": sorted({"environment", *CODE_CHECKPOINTS}),
    "sourceMatches": all(prepared["submissions"][checkpoint] == starter["cache_policy.py"] for checkpoint in CODE_CHECKPOINTS),
    "verifierMatches": tuple(CHECKPOINTS) == tuple(VERIFIER_CHECKPOINTS),
}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const result = JSON.parse(output.trim()) as {
      id: string;
      files: string[];
      checkpoints: string[];
      kinds: Record<string, string>;
      prepared: string[];
      automatic: string[];
      sourceMatches: boolean;
      verifierMatches: boolean;
    };
    expect(result.id).toBe("cs-cache-generation-fence");
    expect(result.files).toEqual(["cache_policy.py"]);
    expect(result.checkpoints).toEqual([
      "environment",
      "audit",
      "basic-invalidate",
      "fence",
      "per-key",
      "generalize",
    ]);
    expect(result.kinds.audit).toBe("answer");
    expect(result.kinds.fence).toBe("code");
    expect(result.prepared).toEqual(result.automatic);
    expect(result.sourceMatches).toBe(true);
    expect(result.verifierMatches).toBe(true);
  });

  it("does not put the audit answer on the inspect wire", () => {
    const probe = `
import json, sys
sys.path.insert(0, ".")
from participant.server import inspect_payload
from fixtures.generate import audit_trace
from verifier.expected import audit_answer
seed = "repo-cache-seed"
payload = inspect_payload(seed)
events = audit_trace(seed)
answer = audit_answer(seed)
print(json.dumps({"payload": payload, "answer": answer, "events": events}))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const result = JSON.parse(output.trim()) as {
      payload: { audit: { events: Array<Record<string, unknown>> } };
      answer: number[];
      events: Array<Record<string, unknown>>;
    };
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.payload.audit.events).toEqual(
      result.events.map((event, index) => ({ index, ...event })),
    );
    expect(JSON.stringify(result.payload)).not.toContain("staleIndices");
    expect(JSON.stringify(result.payload)).not.toContain('"answer"');
  });

  it("lets the STALE_RULE glossary alone reproduce the audit answer, across many seeds (Issue 457)", () => {
    // The audit question states the rule in prose and points at `events`; it never
    // marks which rows qualify. This does not call `audit_answer` -- it replays the
    // stated rule ("a cache_hit is stale when its revision is lower than the latest
    // earlier origin_commit for that key") against the shown events only, so a future
    // change that lets grading depend on a field the events do not carry (or that
    // silently drops rows before they reach the Portal) fails here.
    const probe = `
import json, sys
sys.path.insert(0, ".")
from participant.server import inspect_payload
from verifier.expected import audit_answer
seeds = [f"evidence-chain-cache-{i:03d}" for i in range(50)]
out = []
for seed in seeds:
    events = inspect_payload(seed)["audit"]["events"]
    out.append({"seed": seed, "events": events, "answer": audit_answer(seed)})
print(json.dumps(out))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    const rows = JSON.parse(output.trim()) as Array<{
      seed: string;
      events: Array<{ index: number; op: string; key?: string; revision?: number }>;
      answer: number[];
    }>;
    expect(rows.length).toBeGreaterThan(0);
    const answers: string[] = [];
    for (const row of rows) {
      const latestOriginRevision = new Map<string, number>();
      const derived: number[] = [];
      for (const event of row.events) {
        if (event.op === "origin_commit" && typeof event.key === "string" && typeof event.revision === "number") {
          latestOriginRevision.set(event.key, event.revision);
        }
        if (event.op === "cache_hit" && typeof event.key === "string" && typeof event.revision === "number") {
          const latest = latestOriginRevision.get(event.key) ?? event.revision;
          if (event.revision < latest) derived.push(event.index);
        }
      }
      expect(derived, row.seed).toEqual(row.answer);
      // At least one stale hit exists, but replaying every cache_hit as stale would
      // also pass a vacuous rule -- so the derivation must be selective, too.
      const totalCacheHits = row.events.filter((event) => event.op === "cache_hit").length;
      expect(derived.length, row.seed).toBeGreaterThan(0);
      expect(derived.length, row.seed).toBeLessThan(totalCacheHits);
      answers.push(derived.join(","));
    }
    expect(new Set(answers).size).toBeGreaterThan(1);
  });

  it("separates the public Workbench, hidden verifier, and author artifacts", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = (dockerfile.split("FROM base AS participant")[1] ?? "").split(
      "FROM base AS verifier",
    )[0];
    const verifier = (dockerfile.split("FROM base AS verifier")[1] ?? "").split(
      "FROM participant AS author",
    )[0];
    expect(participant).toContain("tests/public/");
    expect(participant).toContain("participant/");
    expect(participant).not.toMatch(/^COPY .*tests\/hidden/m);
    expect(participant).not.toMatch(/^COPY .*verifier\//m);
    expect(participant).not.toMatch(/^COPY .*reference\//m);
    expect(participant).not.toMatch(/^COPY .*mutation\.py/m);
    expect(verifier).toContain("tests/hidden/");
    expect(verifier).toContain("verifier/");
    expect(verifier).not.toMatch(/^COPY .*tests\/public/m);
    expect(verifier).not.toMatch(/^COPY .*starter\//m);
    expect(verifier).not.toMatch(/^COPY .*reference\//m);
    expect(verifier).not.toMatch(/^COPY .*mutation\.py/m);
    expect(dockerfile).toContain("USER lab");

    const fixtures = readFileSync(join(LOCAL, "fixtures", "generate.py"), "utf8");
    expect(fixtures).not.toContain("def audit_answer");
    expect(fixtures).not.toContain("return rows, stale");
    expect(readFileSync(join(LOCAL, "verifier", "expected.py"), "utf8")).toContain(
      "def audit_answer",
    );

    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    expect(compose).toContain("target: participant");
    expect(compose).toContain("target: verifier");
    expect(compose).toContain("VERIFIER_URL: http://verifier:18341/verify");
    expect(compose).toContain('127.0.0.1:18340:18340');
    expect(compose).not.toContain("18341:18341");
    expect(compose.match(/ports:/g)).toHaveLength(1);
    expect(compose.match(/read_only: true/g)).toHaveLength(2);
    expect(compose.match(/cap_drop:/g)).toHaveLength(2);
    expect(compose).toContain("internal: true");
    expect(compose).toContain('enable_ip_masquerade: "false"');
    expect(compose).toContain("http://127.0.0.1:18340/api/config");
    expect(compose).toContain("http://127.0.0.1:18341/health");
  });

  it("belongs to the internal track without external course alignment", () => {
    expect(existsSync(join(ROOT, "docs", "curricula", "cs-foundations", "curriculum.md"))).toBe(
      true,
    );
    const metadata = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      track?: { id?: string; order?: number };
      courseAlignment?: unknown;
    };
    expect(metadata.track).toEqual({
      id: "cs-foundations",
      order: 40,
      chapter: "4. キャッシュ無効化",
    });
    expect(metadata.courseAlignment).toBeUndefined();
  });
  /**
   * Issue 440 / PR #437: 実 Portal の最初の提出で `prepare` が HTTP 502 を再現していた。
   *
   * Portal 側の 502 は `workbench_unavailable` / `invalid_workbench_response` のどちらかで、
   * **Workbench が契約どおりの JSON を返せなかった**ことしか意味しない。 素の実装は
   * `/api/test` と `/api/prepare` を try/except 無しで呼んでおり、 想定外の例外が出ると
   * BaseHTTPRequestHandler が HTML の traceback を返す。 Portal 側は schema 検証に失敗して
   * 502 を出すが、 **何が起きたかはどこにも残らない**。
   *
   * 例外を JSON の契約へ翻訳して型名を残す。 これは 502 の原因を特定したという主張ではなく、
   * 「原因が残らない 502」を「読めるエラー」に変える変更である。
   */
  it("は POST handler の例外を契約どおりの JSON へ翻訳する", () => {
    const server = readFileSync(join(PROBLEM, "local", "participant", "server.py"), "utf8");
    const post = server.slice(server.indexOf("def do_POST"));
    // test と prepare の両方が守られていること。 片方だけだともう片方で同じ 502 が出る。
    expect(post).toContain('"passed": False, "output": f"public tests raised');
    expect(post).toContain('"ok": False, "output": f"prepare raised');
    // 例外の型名を残すこと。 握り潰して固定文言だけ返すと、502 が別の無情報エラーになるだけ。
    expect(post).toContain("type(error).__name__");
  });

  it("は未知 path でもリクエスト本文を読み捨てる", () => {
    // 読まずに応答すると本文が接続に残り、 接続を再利用するクライアントでは次の要求が
    // 壊れて非 JSON になる。 それも Portal からは同じ 502 に見える。
    const server = readFileSync(join(PROBLEM, "local", "participant", "server.py"), "utf8");
    expect(server).toContain("def _drain_body");
    const notFound = server.slice(server.indexOf('if path not in ("/verify"'));
    expect(notFound.slice(0, 400)).toContain("self._drain_body()");
  });
});
