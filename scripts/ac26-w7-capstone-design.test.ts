import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w7-capstone-design is Week 7's first capstone problem, and the track's only design
 * problem: the learner writes a design *as code* — asset classification, required
 * properties, an option comparison, a selection, a typed data-flow graph, an attack plan,
 * a property matrix — and then answers a brief whose facts have moved.
 *
 * The assertions below run that grading for real. Two of them are the ones that matter:
 * the brief that requires no cryptography must not be answered with a primitive, and a
 * design that hands back a fixed answer when the facts change must fail the last
 * checkpoint. Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w7-capstone-design");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "assets",
  "requirements",
  "alternatives",
  "selection",
  "architecture",
  "attacks",
  "matrix",
  "revision",
] as const;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: 180_000,
  });
}

function bundle(dir: "starter" | "reference"): string {
  return read(`local/${dir}/design.py`);
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

/**
 * Every checkpoint in one interpreter. Scoring one submission per checkpoint is sixteen
 * process spawns for the two blocks below, and the spawn dominates. The catalog's CI budget
 * is shared with forty-odd other problems.
 */
function evaluateAll(submission: string): Record<string, boolean> {
  const script = [
    "import json, sys",
    "sys.path.insert(0, '.')",
    "from verifier.server import CHECKPOINTS, evaluate",
    "source = sys.argv[1]",
    "print(json.dumps({c: evaluate(c, source) for c in CHECKPOINTS}))",
  ].join("\n");
  const result = python(["-c", script, submission]);
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null");
}

/** Run one snippet against the problem's own fixtures and reference, and return its stdout. */
function probe(lines: string[]): string {
  const script = ["import sys", "sys.path.insert(0, '.')", "sys.path.insert(0, 'reference')", ...lines].join(
    "\n",
  );
  const result = python(["-c", script]);
  expect(result.stderr).toBe("");
  return result.stdout.trim();
}

describe("ac26-w7-capstone-design: participant contract", () => {
  it("should ship every file the AC26 template requires", () => {
    for (const path of [
      "Makefile",
      "metadata.json",
      "README.md",
      "README.ja.md",
      "local/docker-compose.yml",
      "local/Dockerfile",
      "local/show.py",
      "local/mutation.py",
      "local/fixtures/generate.py",
      "local/tests/public/test_design.py",
      "local/tests/hidden/check_design.py",
      "local/verifier/server.py",
      "local/starter/design.py",
      "local/reference/design.py",
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }
  });

  it("should expose the four participant targets the template mandates", () => {
    const makefile = read("Makefile");
    for (const target of ["test:", "test-one:", "inspect:", "reset:"]) {
      expect(makefile).toContain(target);
    }
  });

  it("should mount only starter/, keeping the answer out of the checkout", () => {
    const makefile = read("Makefile");
    expect(makefile).toContain("local/starter:/problem/starter:ro");
    expect(makefile).not.toContain("local/reference:");
    expect(makefile).not.toContain("tests/hidden:");
  });

  // The premise of the exercise: the brief states a problem, never a solution.
  it("should never name a primitive in any brief handed to the learner", () => {
    const output = probe([
      "import json",
      "from fixtures.generate import all_briefs, variants, synthetic_briefs",
      "names = ('mpc', 'fhe', 'zk', 'snark', 'homomorphic', 'secret sharing', 'commitment')",
      "hits = []",
      "for b in [*all_briefs(), *variants('ci-fixed-seed'), *synthetic_briefs('ci-fixed-seed')]:",
      "    text = json.dumps(b).lower()",
      "    hits += [n for n in names if n in text]",
      "print(sorted(set(hits)))",
    ]);
    expect(output).toBe("[]");
  });
});

describe("ac26-w7-capstone-design: container safety", () => {
  it("should publish every port on loopback only", () => {
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, { ports?: string[] }>;
    };
    const ports = Object.values(compose.services).flatMap((service) => service.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) expect(mapping.startsWith("127.0.0.1:")).toBe(true);
  });

  it("should require FLAG_SEED rather than defaulting to a committed value", () => {
    expect(read("local/docker-compose.yml")).toContain("${FLAG_SEED:?");
  });

  it("should pin the base image by digest", () => {
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/m);
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w7-capstone-design: the brief set carries its teaching cases", () => {
  // Without a brief that needs nothing, "select the minimum" is unfalsifiable: every answer
  // contains a primitive, so starting from the tool is never punished.
  it("should include exactly one brief that requires no cryptography", () => {
    const output = probe([
      "from fixtures.generate import all_briefs",
      "import design as R",
      "print(sum(1 for b in all_briefs() if R.select_primitive(b) == ['none']))",
    ]);
    expect(output).toBe("1");
  });

  // A brief where somebody relies on a value derived from a secret they may not see is what
  // separates soundness from zero knowledge. Without one, conflating them costs nothing.
  it("should include a brief that requires zero knowledge without requiring privacy", () => {
    const output = probe([
      "from fixtures.generate import all_briefs",
      "import design as R",
      "rows = [R.required_properties(b) for b in all_briefs()]",
      "print(sum(1 for r in rows if r['zero_knowledge'] and not r['privacy']))",
    ]);
    expect(Number(output)).toBeGreaterThan(0);
  });

  it("should include a brief that needs more than one option to cover it", () => {
    const output = probe([
      "from fixtures.generate import all_briefs",
      "import design as R",
      "print(max(len(R.select_primitive(b)) for b in all_briefs()))",
    ]);
    expect(Number(output)).toBeGreaterThanOrEqual(3);
  });

  // The scenario review is only a review if the right answer actually moves for some of
  // them. All eighteen agreeing with their source would make the checkpoint free.
  it("should have variants whose correct answer differs from their source brief", () => {
    const output = probe([
      "from fixtures.generate import all_briefs, variants",
      "import design as R",
      "base = {b['id']: R.select_primitive(b) for b in all_briefs()}",
      "changed = 0",
      "for v in variants('ci-fixed-seed'):",
      "    root = next(k for k in base if v['id'].startswith(k))",
      "    if R.select_primitive(v) != base[root]:",
      "        changed += 1",
      "print(changed)",
    ]);
    expect(Number(output)).toBeGreaterThanOrEqual(5);
  });

  // Every brief in the repository could be answered by a lookup table. These cannot.
  it("should generate briefs that differ from one deploy seed to the next", () => {
    const output = probe([
      "import json",
      "from fixtures.generate import synthetic_briefs",
      "a = json.dumps(synthetic_briefs('seed-a'))",
      "b = json.dumps(synthetic_briefs('seed-b'))",
      "print(a != b)",
    ]);
    expect(output).toBe("True");
  });
});

describe("ac26-w7-capstone-design: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_design.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  }, 180_000);
});

describe("ac26-w7-capstone-design: /verify contract", () => {
  it("should accept the reference submission on every checkpoint", () => {
    const scored = evaluateAll(bundle("reference"));
    expect(scored).toEqual(Object.fromEntries(CHECKPOINTS.map((name) => [name, true])));
  }, 300_000);

  it("should reject the starter submission on every checkpoint", () => {
    const scored = evaluateAll(bundle("starter"));
    expect(scored).toEqual(Object.fromEntries(CHECKPOINTS.map((name) => [name, false])));
  }, 300_000);

  // Each of these returns a complete design. None of them is the right one.
  it("should reject a design that reaches for a primitive when none is required", () => {
    const source = bundle("reference").replace(
      '    if _covers(["none"], required) and is_admissible("none", brief):\n        return ["none"]',
      "    pass",
    );
    expect(evaluate("selection", source)).toBe(false);
  }, 120_000);

  it("should reject a selection carrying an option that covers nothing new", () => {
    const source = bundle("reference").replace(
      "    for size in range(1, len(admissible) + 1):",
      "    if _covers(admissible, required):\n        return sorted(admissible)\n    for size in range(1, len(admissible) + 1):",
    );
    expect(evaluate("selection", source)).toBe(false);
  }, 120_000);

  it("should reject requiring zero knowledge wherever soundness is required", () => {
    const source = bundle("reference").replace(
      '        for source_id in asset.get("derived_from", []):',
      '        required["zero_knowledge"] = True\n        for source_id in asset.get("derived_from", []):',
    );
    expect(evaluate("requirements", source)).toBe(false);
  }, 120_000);

  it("should reject an architecture that sends a secret to its adversary in the clear", () => {
    const source = bundle("reference").replace(
      '    if not asset["must_not_learn"]:\n        return "plaintext"\n    return "share" if "mpc" in selection else "ciphertext"',
      '    return "plaintext"',
    );
    expect(evaluate("architecture", source)).toBe(false);
  }, 120_000);

  it("should reject a property delegated to a component that does not provide it", () => {
    const source = bundle("reference").replace(
      '    for node in graph["nodes"]:\n        for primitive in node["primitives"]:\n            if prop in PRIMITIVES[primitive]["provides"]:\n                return node["id"]\n    return ""',
      '    return graph["nodes"][0]["id"]',
    );
    expect(evaluate("matrix", source)).toBe(false);
  }, 120_000);

  // The whole argument of the problem, as one assertion.
  it("should reject a design that answers a changed brief with the one it already had", () => {
    const source = bundle("reference").replace(
      "    selection = select_primitive(brief)\n    graph = architecture(brief, selection)\n    return {",
      '    from fixtures.generate import brief as _fixed\n    brief = _fixed("joint-statistic")\n    selection = select_primitive(brief)\n    graph = architecture(brief, selection)\n    return {',
    );
    expect(evaluate("revision", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("assets", "def classify_assets(brief):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("assets", "def classify_assets(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("design-the-capstone", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

/**
 * Everything above calls `evaluate()` directly, which is how a wrong bind address survives a
 * fully green suite: the scoring logic is perfect and the platform still cannot reach it.
 *
 * The verifier is reached over a published container port, which Docker forwards to the
 * container's bridge address — so a server listening on 127.0.0.1 *inside* the container
 * accepts nothing from outside it. Every request is opened and closed with no response, and
 * no checkpoint can ever score. Found by running the container, not by reading the code.
 *
 * Note what each assertion below can and cannot prove. The round trip runs the real server
 * over a real socket, which covers the whole HTTP handler path that `evaluate()` skips — but
 * it runs on the host, where loopback reaches loopback, so it passes with either bind
 * address. Only the source assertion catches the container-specific fault. Reproducing it
 * honestly would need the container itself, and CI has no Docker daemon.
 *
 * Host-side loopback is the compose file's job (`127.0.0.1:<port>:<port>`), asserted below
 * and in the container-safety block above.
 */
describe("ac26-w7-capstone-design: the verifier is reachable, not only correct", () => {
  const PORT = "18919";

  /** Start the real server, drive it over a real socket, and always shut it down. */
  function roundTrip(): { ready: boolean; reference: string; malformed: number } {
    const script = [
      "import json, subprocess, sys, time, urllib.error, urllib.request",
      "",
      "def post(payload, timeout=90):",
      "    request = urllib.request.Request(",
      `        "http://127.0.0.1:${PORT}/verify",`,
      "        data=payload,",
      '        headers={"content-type": "application/json"},',
      "    )",
      "    try:",
      "        response = urllib.request.urlopen(request, timeout=timeout)",
      "        return response.status, response.read().decode()",
      "    except urllib.error.HTTPError as error:",
      "        return error.code, error.read().decode()",
      "",
      "proc = subprocess.Popen(",
      '    [sys.executable, "verifier/server.py"],',
      "    env={",
      '        "PATH": "/usr/bin:/bin:/usr/local/bin",',
      `        "VERIFY_PORT": "${PORT}",`,
      `        "FLAG_SEED": "${SEED}",`,
      '        "PYTHONDONTWRITEBYTECODE": "1",',
      "    },",
      ")",
      "try:",
      "    ready = False",
      "    for _ in range(100):",
      "        try:",
      "            post(b'{}', timeout=2)",
      "            ready = True",
      "            break",
      "        except Exception:",
      "            time.sleep(0.1)",
      "    result = {'ready': ready, 'reference': '', 'malformed': 0}",
      "    if ready:",
      '        source = open("reference/design.py", encoding="utf-8").read()',
      "        body = json.dumps({'checkpointId': 'selection', 'submission': source}).encode()",
      "        result['reference'] = post(body)[1]",
      "        result['malformed'] = post(b'not json')[0]",
      "    print(json.dumps(result))",
      "finally:",
      "    proc.terminate()",
      "    proc.wait(timeout=10)",
    ].join("\n");
    const result = spawnSync("python3", ["-c", script], {
      cwd: LOCAL,
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout.trim());
  }

  it("should answer over the socket the platform actually connects to", () => {
    const result = roundTrip();
    // Covers the HTTP handler end to end — request parsing, the checkpoint lookup, the
    // subprocess run, and the response — none of which `evaluate()` exercises.
    expect(result.ready).toBe(true);
    expect(JSON.parse(result.reference)).toEqual({ checkpointId: "selection", correct: true });
    // And a malformed body is answered rather than killing the process.
    expect(result.malformed).toBe(400);
  }, 240_000);

  it("should not bind the container's own loopback, which no published port reaches", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).not.toMatch(/HTTPServer\(\(\s*["']127\.0\.0\.1["']/);
    expect(verifier).toMatch(/HTTPServer\(\(\s*["']0\.0\.0\.0["']/);
  });

  it("should keep the host-side loopback restriction in the compose file", () => {
    expect(read("local/docker-compose.yml")).toContain("127.0.0.1:18119:18119");
  });
});

describe("ac26-w7-capstone-design: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { order: number };
      courseAlignment: {
        week: number;
        role: string;
        sources?: Array<{ kind: string; ref: string; path: string }>;
      };
      scoring: {
        kind: string;
        checks: Array<{ id: string; points: number; hints?: Array<{ penalty: number }> }>;
      };
    };
  }

  it("should total the Hard tier's 300 points across its checkpoints", () => {
    const meta = metadata();
    expect(meta.scoring.kind).toBe("multi-verify");
    expect(meta.difficulty).toBe(5);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  // Week 7 has no directory upstream at the pinned commit, so there is no lecture or
  // assignment to cite. SYNC.md §2 fixes what a capstone pins instead: the roadmap.
  it("should pin the repository roadmap, because week 7 has no material to pin", () => {
    const { courseAlignment, status, track } = metadata();
    expect(courseAlignment.week).toBe(7);
    expect(courseAlignment.role).toBe("synthesis");
    expect(track.order).toBe(710);
    expect(courseAlignment.sources?.map((source) => source.kind)).toEqual(["roadmap"]);
    expect(courseAlignment.sources?.map((source) => source.path)).toEqual(["README.md"]);
    for (const source of courseAlignment.sources ?? []) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(status).toBe("draft");
  });

  // Week 6 is not in the catalog yet, so the cross-week prerequisite cannot be declared
  // without dangling. Every other week's first problem declares none either; this asserts
  // the state is deliberate rather than forgotten.
  it("should declare no problem-level prerequisite while week 6 is absent", () => {
    const meta = JSON.parse(read("metadata.json")) as {
      relations: Array<{ type: string; target: string }>;
    };
    const prerequisites = meta.relations
      .filter((relation) => relation.type === "requires")
      .map((relation) => relation.target)
      .filter((target) => target.startsWith("problem."));
    expect(prerequisites).toEqual([]);
  });
});
