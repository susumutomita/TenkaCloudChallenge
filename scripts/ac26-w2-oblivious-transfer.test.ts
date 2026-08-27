import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * `ac26-w2-oblivious-transfer` — the Week 2 Part B companion (Issue 412).
 *
 * ## Why this problem exists
 *
 * The official Week 2 exercise has two halves. This track accompanied only the first
 * (arithmetic MPC: sharing, local addition, Beaver multiplication) and had nothing at
 * all for the second — oblivious transfer and the GMW secret AND. A learner who
 * finished the track met OT for the first time in the official assignment.
 *
 * ## What is pinned here
 *
 * The two properties the problem is actually about, and neither is "does it produce
 * the right answer". Both failures below are **correct on every input** and still hand
 * a secret to the other side, which is precisely why a test that only reconstructs
 * cannot see them:
 *
 *   - drawing the receiver's blind from `1..q-1` instead of `0..q-1` makes two group
 *     elements reachable under one choice and not the other, naming the choice bit;
 *   - reusing one mask across the gate's two transfers still cancels under XOR, while
 *     turning each party's output share into a readout of the other party's bits.
 *
 * The mutation suite is the load-bearing check and it runs inside the image, so it is
 * not reachable here. What is reachable without Docker is the hidden suite itself, run
 * against the reference and against those two mutations — which is the part that would
 * silently rot if someone "simplified" the privacy checks into the correctness ones.
 */

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBLEM = join(REPO_ROOT, "challenges", "ac26-w2-oblivious-transfer");
const LOCAL = join(PROBLEM, "local");

/** Run the hidden suite against a source string, the way `/verify` does. */
function hiddenFailures(source: string): string[] {
  const script = `
import json, sys, types
sys.path.insert(0, ${JSON.stringify(LOCAL)})
from tests.hidden.check_oblivious import run
module = types.ModuleType("candidate")
exec(compile(sys.stdin.read(), "<candidate>", "exec"), module.__dict__)
print(json.dumps(run(module, "pinned-suite-seed")))
`;
  const out = execFileSync("python3", ["-c", script], {
    input: source,
    encoding: "utf8",
    timeout: 120_000,
  });
  return JSON.parse(out.trim().split("\n").at(-1) as string) as string[];
}

function portalContract(): { id: string; checkpoints: string[]; prepared: string[] } {
  // The Portal editor API lives in participant/server.py since the Issue 543 option B2
  // split; the verifier keeps only the scoring seam. Both sides of the seal are checked
  // here, because the verifier now duplicates the unwrap rather than importing it -- if
  // the two derivations drifted, a Portal-prepared submission would stop scoring.
  const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(LOCAL)})
from participant.server import CHECKPOINTS, _WORKBENCH
from verifier.server import CHECKPOINTS as VERIFIER_CHECKPOINTS, _unwrap_submission
source = Path(${JSON.stringify(join(LOCAL, "reference", "oblivious.py"))}).read_text()
config = _WORKBENCH.config_payload()
prepared = _WORKBENCH.prepare_submissions({"oblivious.py": source}, {})
assert prepared["ok"] is True
assert tuple(item["id"] for item in config["checkpoints"]) == CHECKPOINTS
assert VERIFIER_CHECKPOINTS == CHECKPOINTS
assert set(prepared["submissions"]) == set(CHECKPOINTS)
for checkpoint, submission in prepared["submissions"].items():
    assert _WORKBENCH.unwrap_submission(checkpoint, submission) == source
    assert _unwrap_submission(checkpoint, submission) == source
    assert _unwrap_submission(checkpoint, source) == source
print(json.dumps({
    "id": config["id"],
    "checkpoints": [item["id"] for item in config["checkpoints"]],
    "prepared": sorted(prepared["submissions"]),
}))
`;
  const out = execFileSync("python3", ["-c", script], { encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").at(-1) as string);
}

const REFERENCE = readFileSync(join(LOCAL, "reference", "oblivious.py"), "utf8");
const STARTER = readFileSync(join(LOCAL, "starter", "oblivious.py"), "utf8");

/** Apply a mutation and prove it applied — a no-op replace would pass vacuously. */
function mutate(from: string, to: string): string {
  const mutated = REFERENCE.replace(from, to);
  expect(mutated, `mutation did not apply: ${from}`).not.toBe(REFERENCE);
  return mutated;
}

describe("ac26-w2-oblivious-transfer: the problem holds up (Issue 412)", () => {
  it("は reference が hidden suite を通る", () => {
    expect(hiddenFailures(REFERENCE)).toEqual([]);
  });

  it("は starter のままでは通らない", () => {
    // 配布状態で満点が出る問題は問題ではない。
    expect(hiddenFailures(STARTER).length).toBeGreaterThan(0);
  });

  it("は Participant Portal に正しい problem と全 checkpoint を公開する", () => {
    const contract = portalContract();
    const checkpoints = [
      "request",
      "choice-privacy",
      "transfer",
      "and-gate",
      "gate-privacy",
      "unseen",
    ];
    expect(contract.id).toBe("ac26-w2-oblivious-transfer");
    expect(contract.checkpoints).toEqual(checkpoints);
    expect(contract.prepared).toEqual([...checkpoints].sort());
  });

  it("は starter が privacy checkpoint を素通りしないようにする", () => {
    // 実際に開いた穴の回帰テスト。starter は offer も output_share も定数を返すので、
    // 「自分の view が相手の秘密で動かない」は何も計算しないことで完璧に成立していた。
    // solvability audit が `gate-privacy / starter-passes` を 10/10 seed で検出した。
    //
    // privacy は「動く protocol について」の主張なので、両 checkpoint は対応する
    // 正しさ phase を一緒に走らせる。ここで固定するのは checkpoint の構成そのもの。
    const server = readFileSync(join(LOCAL, "verifier", "server.py"), "utf8");
    const phases = /"choice-privacy": \(([^)]*)\)/.exec(server)?.[1] ?? "";
    expect(phases).toContain("check_request");
    const gate = /"gate-privacy": \(([^)]*)\)/.exec(server)?.[1] ?? "";
    expect(gate).toContain("check_and_gate");

    // 構成だけでなく挙動も見る: starter は両方の phase 集合で落ちること。
    const failures = hiddenFailures(STARTER);
    expect(failures.join(" ")).toContain("subgroup");
  });

  it("は blind から 0 を外した実装を、正しく動いていても落とす", () => {
    // 1 回の転送は成功し続ける。落ちるのは分布の検査だけ。
    const failures = hiddenFailures(
      mutate('    return (0, grp["q"] - 1)', '    return (1, grp["q"] - 1)'),
    );
    expect(failures.join(" ")).toContain("distribution");
  });

  it("は mask を 1 つに使い回した実装を、復元が正しくても落とす", () => {
    const leaky = mutate(
      "    return (randomness[0], randomness[1])",
      "    return (randomness[0], randomness[0])",
    );
    const failures = hiddenFailures(leaky);
    // 「復元は正しいのに落ちる」ことがこの問題の主張なので、両方を固定する。
    // 正しさの検査まで落ちていたら、それは privacy を教えていることにならない。
    expect(failures).toEqual([
      "party 0's view of the gate changes with party 1's secret bits, so the two " +
        "transfers are not independently masked",
    ]);
  });

  it("は party 1 だけへ漏れる非対称 mask を、復元が正しくても落とす", () => {
    const leaky = mutate(
      "    return (randomness[0], randomness[1])",
      "    return (0, randomness[1])",
    );
    expect(hiddenFailures(leaky)).toEqual([
      "party 1's view of the gate changes with party 0's secret bits, so the two " +
        "transfers are not independently masked",
    ]);
  });

  it("は両平文を埋め込む可逆 ciphertext を transfer と認めない", () => {
    const encoded = mutate(
      "    return (message_0 ^ key_0, message_1 ^ key_1)",
      "    return ((1 << 64) | message_0, (1 << 64) | message_1)",
    ).replace(
      "    return ciphertexts[choice] ^ key",
      "    return ciphertexts[choice] & ((1 << 32) - 1)",
    );
    expect(hiddenFailures(encoded).join(" ")).toContain(
      "ciphertexts do not use the declared independent sender keys",
    );
  });

  it("は verifier container を非 root と healthcheck 付きで動かす", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const compose = readFileSync(join(LOCAL, "docker-compose.yml"), "utf8");
    expect(dockerfile).toContain("USER lab");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("127.0.0.1:18310/api/config");
  });

  it("は公式課題の Part B に対応する pin を持つ", () => {
    const meta = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")) as {
      courseAlignment: { week: number; sources: { path: string; kind: string }[] };
      scoring: { checks: { id: string; points: number }[] };
    };
    expect(meta.courseAlignment.week).toBe(2);
    expect(meta.courseAlignment.sources.map((s) => s.kind).toSorted()).toEqual([
      "assignment",
      "lecture",
    ]);
    expect(meta.scoring.checks.reduce((sum, c) => sum + c.points, 0)).toBe(200);
  });

  it("は参加者に配る面へ reference を混ぜない", () => {
    // starter と公開テストしか読めない参加者が、答えを読めてはいけない。
    const surface = [
      readFileSync(join(LOCAL, "starter", "oblivious.py"), "utf8"),
      readFileSync(join(LOCAL, "tests", "public", "test_oblivious.py"), "utf8"),
      readFileSync(join(PROBLEM, "README.md"), "utf8"),
      readFileSync(join(PROBLEM, "README.ja.md"), "utf8"),
    ].join("\n");
    expect(surface).not.toContain("(randomness[0], randomness[1])");
    expect(surface).not.toContain("mask ^ own_bit");
    expect(surface).not.toContain("(own_x & own_y) ^ own_mask ^ received");
  });
});

/**
 * Issue 537/538 (Issue 543 option B2). This problem shipped as a single Docker stage that
 * carried `fixtures/`, `tests/` and `verifier/` in the same image a learner's own
 * `make build` produced. All six checkpoints are graded by running
 * `tests/hidden/check_oblivious.py` against the submitted file, so the person being graded
 * was shipped the assertions — including `check_receiver_privacy` and `check_gate_privacy`,
 * which state the two properties the problem exists to make a learner derive. It came off
 * the `COPY verifier/` list in docs/AGENT_LOOP_CONSTRAINTS.md §5 with this change.
 *
 * The tests below pin the boundary that fix put in, in the two ways it can be checked
 * without a Docker daemon: the Dockerfile's own COPY lists, and the participant stage's
 * real file list run through the same derivation `check-answer-reachability.ts` uses.
 * Restoring any of the three COPY lines turns them red.
 */

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w2-oblivious-transfer";
const CHECKPOINT_IDS = [
  "request",
  "choice-privacy",
  "transfer",
  "and-gate",
  "gate-privacy",
  "unseen",
] as const;

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: "ci-fixed-seed", PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  });
}

function evaluate(checkpointId: string, submission: string): boolean {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import evaluate",
    "print(json.dumps(evaluate(sys.argv[1], sys.argv[2])))",
  ].join("\n");
  const result = python(["-c", script, checkpointId, submission]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null") === true;
}

describe("ac26-w2-oblivious-transfer: the participant image carries nothing that grades", () => {
  it("keeps fixtures/, the hidden suite and the verifier out of the participant Docker stage", () => {
    const dockerfile = readFileSync(join(LOCAL, "Dockerfile"), "utf8");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("COPY --chown=lab:lab fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY --chown=lab:lab verifier/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(participantStage).not.toContain("COPY --chown=lab:lab mutation.py");
    expect(participantStage).toContain("COPY --chown=lab:lab tests/public/");
    expect(participantStage).toContain("COPY --chown=lab:lab participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY --chown=lab:lab fixtures/");
    expect(verifierStage).toContain("COPY --chown=lab:lab tests/hidden/");
    expect(verifierStage).toContain("COPY --chown=lab:lab verifier/");
    // The supplied key derivation, and only that: the Portal server and its adapter stay
    // out of the grading image.
    expect(verifierStage).toContain("COPY --chown=lab:lab participant/ot.py");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab participant/\n");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab reference/");
    expect(verifierStage).not.toContain("COPY --chown=lab:lab mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches the derivation or the hidden assertions", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(REPO, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_oblivious.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_oblivious.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/ot.py`);
    for (const file of participantFiles) {
      const source = readFileSync(join(REPO, file), "utf8");
      // The one permitted mention is the lazy, function-scoped checkout/author fallback
      // in show.py and the public tests: never a module-level import, which is what
      // would fail loudly the moment it ran inside a participant image that carries no
      // `fixtures/` at all.
      expect(source).not.toMatch(/^from fixtures/m);
      expect(source).not.toMatch(/^import fixtures/m);
      expect(source).not.toMatch(/^from tests\.hidden/m);
      expect(source).not.toMatch(/^from verifier/m);
    }
  });

  it("publishes only the Workbench, and reaches the verifier over an internal network", () => {
    const compose = parseYaml(readFileSync(join(LOCAL, "docker-compose.yml"), "utf8")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL are what metadata.json's runtime declares,
    // and they did not move: the Workbench answers on 18310 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18310:18310"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(readFileSync(join(PROBLEM, "metadata.json"), "utf8")).runtime as {
      verifyUrl: string;
    };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18310/verify");
  });
});

describe("ac26-w2-oblivious-transfer: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. This problem was one of the ten Issue 591 left
    // unguarded, because its reference imported `derive_key` from `fixtures.generate`;
    // the split moved that helper to `participant/ot.py`, which the guard does not evict,
    // so the guard could go in. Measured, not assumed.
    for (const checkpoint of CHECKPOINT_IDS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 180_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and
    // pastes it, so the RUNNER guard -- which only blocks `import` -- is not in the
    // path. The reference passing every checkpoint above is this probe's positive
    // control (docs/AGENT_LOOP_CONSTRAINTS.md §5): without one, a silently broken probe
    // reports the same zero as a closed problem.
    const shipped = readFileSync(join(LOCAL, "participant", "ot.py"), "utf8");
    for (const checkpoint of CHECKPOINT_IDS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 180_000);

  it("still grades the reference through the guard", () => {
    // The guard removes the problem root from sys.path while the submission is imported.
    // The reference's own `from participant.ot import derive_key` has to keep resolving
    // through the module cache, or every checkpoint would fail for the wrong reason --
    // which is exactly the breakage that kept this problem on Issue 591's exception list.
    expect(evaluate("unseen", REFERENCE)).toBe(true);
  }, 180_000);
});

describe("ac26-w2-oblivious-transfer: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, group, keypair, session, wires, health_token",
      "seed = sys.argv[1]",
      "payload = public_payload(seed)",
      "print(json.dumps({",
      "  'group': payload['group'] == group(seed),",
      "  'senderKey': payload['senderKey'] == keypair(seed),",
      "  'session': payload['session'] == session(seed, 'public'),",
      "  'wires': payload['wires'] == wires(seed, 'public'),",
      "  'healthToken': payload['healthToken'] == health_token(seed),",
      // Nothing under a hidden label travels: the suite grades h0..h3 and `unseen`
      // grades under a seed suffix that is never served.
      "  'noHiddenLabels': all(",
      "     payload['session'] != session(seed, label) for label in ('h0','h1','h2','h3')",
      "  ),",
      "}))",
    ].join("\n");
    const result = python(["-c", script, "ci-fixed-seed"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      group: true,
      senderKey: true,
      session: true,
      wires: true,
      healthToken: true,
      noHiddenLabels: true,
    });
  });

  it("prints exactly what it printed before the split, on every seed shape", () => {
    // show.py reads `GET /public` now instead of importing `fixtures.generate`. What a
    // learner sees must not have moved with it, so the injected-payload path is compared
    // against the checkout fallback across seeds spanning several of the ten groups.
    for (const seed of ["ci-fixed-seed", "seed-a", "seed-b", "seed-c"]) {
      const direct = spawnSync("python3", ["show.py"], {
        cwd: LOCAL,
        encoding: "utf8",
        env: { ...process.env, FLAG_SEED: seed, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 60_000,
      });
      expect(direct.status).toBe(0);

      const payload = python([
        "-c",
        "import json,sys; sys.path.insert(0,'.'); from fixtures.generate import public_payload; print(json.dumps(public_payload(sys.argv[1])))",
        seed,
      ]);
      expect(payload.status).toBe(0);
      const injected = spawnSync("python3", ["show.py"], {
        cwd: LOCAL,
        encoding: "utf8",
        env: {
          ...process.env,
          FLAG_SEED: seed,
          PYTHONDONTWRITEBYTECODE: "1",
          PUBLIC_EVIDENCE_JSON: payload.stdout.trim().split("\n").at(-1) ?? "",
        },
        timeout: 60_000,
      });
      expect(injected.status).toBe(0);
      expect(injected.stdout).toBe(direct.stdout);
    }
  }, 120_000);
});
