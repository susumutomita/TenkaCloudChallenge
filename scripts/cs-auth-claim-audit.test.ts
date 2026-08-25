import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

/**
 * `cs-auth-claim-audit` — the problem's own conformance suite (Issue 407).
 *
 * The Python side already carries three layers: public tests (which pass the broken
 * starter, on purpose), a hidden suite, and a mutation suite that breaks the reference
 * nine ways and requires the hidden suite to notice each one. Repeating any of that
 * here would be ceremony.
 *
 * What this file adds is the part the Python cannot check about itself:
 *
 *   - **the mutation suite actually runs and is green**, so a hidden suite that has
 *     quietly stopped detecting anything fails repository CI rather than only failing
 *     when an author remembers to run `make reference-test`;
 *   - **the reference is not in the participant image**, which is a Dockerfile
 *     property, not a Python one;
 *   - **the premise still holds** — the public tests pass the shipped starter. If a
 *     well-meaning edit ever makes them fail it, the problem silently stops being
 *     about anything, and every other test here would still be green.
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(ROOT, "challenges", "cs-auth-claim-audit");
const LOCAL = join(PROBLEM, "local");

/** Run a Python entry point inside `local/`, returning stdout and the exit status. */
function python(script: string, args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync("python3", [script, ...args], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, FLAG_SEED: "repo-suite-seed", PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("cs-auth-claim-audit のハーネス", () => {
  it("は mutation suite の全 mutant を hidden suite で殺す", () => {
    // これが緑でなくなったとき、hidden suite は「reference が通る」以外を保証していない。
    const result = python("mutation.py");
    expect(result.output).toContain("reference: passes");
    expect(result.output).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });

  it("は公開テストを、壊れた starter のまま通す", () => {
    // 問題の前提そのもの。公開テストが starter を落とすようになったら、
    // 「テストが緑なのに壊れている」を体験させる構造が消えている。
    const result = python("tests/public/test_authorize.py");
    expect(result.output).toContain("all passed");
    expect(result.status).toBe(0);
  });

  it("は starter を hidden suite の 3 phase すべてで落とす", () => {
    // 公開テストが通る starter が hidden で落ちることが、この問題の主張の本体。
    const probe = `
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "starter")
import authorize
from tests.hidden import check_authorize as chk
print(json.dumps({
    "verify": len(chk.check_verify(authorize, "repo-suite-seed")),
    "isolate": len(chk.check_isolate(authorize, "repo-suite-seed")),
    "generalize": len(chk.check_generalize(authorize, "repo-suite-seed")),
}))
`;
    const run = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    const failures = JSON.parse(run.trim()) as Record<string, number>;
    for (const [phase, count] of Object.entries(failures)) {
      expect(count, `${phase} は starter を通してしまっている`).toBeGreaterThan(0);
    }
  });

  it("は reference と mutation suite を参加者イメージへ入れない", () => {
    // 誤配の防止。秘匿ではない (author stage をビルドすれば読める) が、
    // 参加者が普通に build したときに答えが手元に来ないことは保てる。
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participant = dockerfile.slice(0, dockerfile.indexOf("AS author"));
    expect(participant).not.toContain("COPY reference/");
    expect(participant).not.toContain("COPY mutation.py");
    expect(dockerfile).toContain("COPY --chown=lab:lab reference/ ./reference/");
    // compose は participant stage を明示すること。省くと最後の stage (= author) が建つ。
    expect(readFileSync(join(LOCAL, "docker-compose.yml"), "utf8")).toContain("target: participant");
  });

  it("は verifier を非 root で起動し、compose が実際の API を監視する", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("RUN useradd --create-home --uid 10001 lab");
    expect(dockerfile).toContain("USER lab");
    expect(dockerfile).toContain("COPY --chown=lab:lab verifier/ ./verifier/");

    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("http://127.0.0.1:18300/api/config");
  });

  it("は答えを inspect の payload へ載せない", () => {
    const probe = `
import json, sys
sys.path.insert(0, ".")
from verifier.server import inspect_payload
from fixtures.generate import decision_log, validity_window
seed = "repo-suite-seed"
payload = inspect_payload(seed)
_entries, wrong = decision_log(seed)
print(json.dumps({
    "serialized": json.dumps(payload, sort_keys=True),
    "wrong": wrong,
    "window": validity_window(seed),
}))
`;
    const run = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    const { serialized, wrong, window } = JSON.parse(run.trim()) as {
      serialized: string;
      wrong: number[];
      window: number[];
    };
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    // 証拠は載る。答えは載らない。
    expect(Object.keys(payload).toSorted()).toEqual(["audit", "environment", "window"]);
    expect(serialized).not.toContain(`"wrong"`);
    expect(JSON.stringify(payload.audit)).not.toContain(JSON.stringify(wrong));
    expect(JSON.stringify(payload.window)).not.toContain(JSON.stringify(window));
  });

  it("hands the participant everything window and audit need, across many seeds (Issue 457)", () => {
    // `window` and `audit` are direct-answer checkpoints graded against
    // `validity_window` / `decision_log`, but neither is called here. This
    // reimplements, in a different language and independently of the Python
    // fixtures, exactly what the question text tells the participant to do:
    // read `nbf`/`exp` off the shown claims, and recompute each row's MAC with the
    // shown keys to tell a forged or cross-tenant request from a genuine one. If a
    // future change ever let grading depend on something not on this wire -- an
    // un-shown key, a claim field the payload stops printing, a rule the question
    // does not state -- this fails even though CLI/Portal parity stays green.
    const probe = String.raw`
import json, sys
sys.path.insert(0, ".")
from verifier.server import inspect_payload
from fixtures.generate import decision_log, validity_window
seeds = [f"evidence-chain-auth-{i:03d}" for i in range(50)]
out = []
for seed in seeds:
    payload = inspect_payload(seed)
    _entries, wrong = decision_log(seed)
    out.append({
        "seed": seed,
        "claims": payload["window"]["claims"],
        "keys": payload["audit"]["keys"],
        "entries": payload["audit"]["entries"],
        "window": validity_window(seed),
        "wrong": wrong,
    })
print(json.dumps(out))
`;
    const output = execFileSync("python3", ["-c", probe], {
      cwd: LOCAL,
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    type Entry = {
      index: number;
      token: string;
      action: string;
      resource: { id: string; tenant: string };
      now: number;
      gatewayDecision: string;
    };
    const rows = JSON.parse(output.trim()) as Array<{
      seed: string;
      claims: { nbf: number; exp: number };
      keys: Record<string, string>;
      entries: Entry[];
      window: [number, number];
      wrong: number[];
    }>;
    expect(rows.length).toBeGreaterThan(0);

    const decodeSegment = (segment: string): unknown => {
      try {
        return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
      } catch {
        return null;
      }
    };

    const allowedCounts: number[] = [];
    for (const row of rows) {
      // window: nbf is inclusive, exp is exclusive, so the last accepted instant is
      // exp - 1. This is read straight off the claims the Portal already shows.
      expect([row.claims.nbf, row.claims.exp - 1], row.seed).toEqual(row.window);

      // audit: recompute, from the shown keys and each token's own bytes, whether the
      // gateway's decision was the one a correct gateway would have made.
      const derivedWrong: number[] = [];
      let allowedCount = 0;
      for (const entry of row.entries) {
        if (entry.gatewayDecision === "allow") allowedCount += 1;
        const parts = entry.token.split(".");
        let shouldAllow = false;
        if (parts.length === 3) {
          const [head, body, mac] = parts as [string, string, string];
          const header = decodeSegment(head) as { alg?: unknown; kid?: unknown } | null;
          const claims = decodeSegment(body) as
            | { nbf?: unknown; exp?: unknown; scope?: unknown; tenant?: unknown }
            | null;
          const kid = typeof header?.kid === "string" ? header.kid : undefined;
          const secretHex = kid ? row.keys[kid] : undefined;
          let validSignature = false;
          if (header?.alg === "hs256" && secretHex) {
            const expected = createHmac("sha256", Buffer.from(secretHex, "hex"))
              .update(`${head}.${body}`, "utf8")
              .digest();
            try {
              const actual = Buffer.from(mac, "base64url");
              validSignature = actual.length === expected.length && actual.equals(expected);
            } catch {
              validSignature = false;
            }
          }
          const nbf = claims?.nbf;
          const exp = claims?.exp;
          const timeValid =
            typeof nbf === "number" && typeof exp === "number" && nbf <= entry.now && entry.now < exp;
          const scope = Array.isArray(claims?.scope) ? (claims?.scope as unknown[]) : [];
          const scopeValid = scope.includes(entry.action);
          const tenantValid = claims?.tenant === entry.resource.tenant;
          shouldAllow = validSignature && timeValid && scopeValid && tenantValid;
        }
        if (entry.gatewayDecision === "allow" && !shouldAllow) derivedWrong.push(entry.index);
      }
      expect(derivedWrong, row.seed).toEqual(row.wrong);
      allowedCounts.push(allowedCount);
    }
    // The audit answer is never the whole log and never empty: a log with nothing the
    // gateway got wrong, or nothing it got right, would not be an audit.
    for (const row of rows) {
      expect(row.wrong.length, row.seed).toBeGreaterThan(0);
    }
    expect(rows.every((row, i) => row.wrong.length < allowedCounts[i])).toBe(true);
  });

  it("は track の curriculum を持つ", () => {
    // `stackstack-route` と同じ約束。track に属する問題があるのに順序の根拠が
    // どこにも無い状態を作らない。
    expect(existsSync(join(ROOT, "docs", "curricula", "cs-foundations", "curriculum.md"))).toBe(
      true,
    );
    const metadata = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      track?: { id?: string };
      courseAlignment?: unknown;
    };
    expect(metadata.track?.id).toBe("cs-foundations");
    // 上流 SHA を pin していないので course:drift の対象にはならない。持っていたら
    // 到達できない upstream を毎回 CI が問い合わせることになる。
    expect(metadata.courseAlignment).toBeUndefined();
  });
});
