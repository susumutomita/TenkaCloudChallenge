import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";
import { participantPythonFiles } from "./lib/local-play-problems";

/**
 * ac26-w3-ec-group is Week 3's group-law problem. The assertions that carry weight run
 * its Python for real, and the one this problem exists for is the (0, 0) trap: most of
 * the toy curves contain that point, so an implementation using it for the identity has
 * a genuine, observable defect rather than a stylistic one. Python 3 is on
 * ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w3-ec-group");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "on-curve",
  "identity",
  "add",
  "double",
  "scalar",
  "trace",
  "properties",
  "secp256k1",
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
  return read(`local/${dir}/curve.py`);
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
 * The mechanical half of the transcription probe below: the starter's own declared API,
 * with every method delegating to the `_ReferenceCurve` copied out of the hidden checker.
 * Nothing here is derived from the mathematics -- that is the point. It is kept out of
 * `local/` because it is a probe, not a reference solution.
 */
const TRANSCRIBED_WRAPPER = `
class Point:
    __slots__ = ("curve", "x", "y")

    def __init__(self, curve, x, y):
        self.curve, self.x, self.y = curve, x, y

    @property
    def is_infinity(self):
        return self.x is None and self.y is None

    def __eq__(self, other):
        return isinstance(other, Point) and other.x == self.x and other.y == self.y

    def __hash__(self):
        return hash((self.x, self.y))

    def __repr__(self):
        return "Point(infinity)" if self.is_infinity else f"Point({self.x}, {self.y})"

    def _c(self):
        return None if self.is_infinity else (self.x, self.y)

    def _wrap(self, coords):
        return Point(self.curve, *(coords if coords is not None else (None, None)))

    def __neg__(self):
        return self._wrap(self.curve._ref().neg(self._c()))

    def __add__(self, other):
        if not isinstance(other, Point):
            return NotImplemented
        if other.curve.params != self.curve.params:
            raise CurveMismatch("two different curves")
        return self._wrap(self.curve._ref().add(self._c(), other._c()))

    def __mul__(self, scalar):
        return self.scalar_mul(scalar)

    def __rmul__(self, scalar):
        return self.scalar_mul(scalar)

    def scalar_mul(self, scalar):
        return self._wrap(self.curve._ref().mul(self._c(), scalar))


class Curve:
    def __init__(self, p, a, b):
        self.p, self.a, self.b = p, a % p, b % p

    def _ref(self):
        return _ReferenceCurve(self.p, self.a, self.b)

    @property
    def params(self):
        return (self.p, self.a, self.b)

    def contains(self, point):
        if point.is_infinity:
            return True
        return (point.y * point.y - point.x ** 3 - self.a * point.x - self.b) % self.p == 0

    def point(self, x, y):
        candidate = Point(self, x % self.p, y % self.p)
        if not self.contains(candidate):
            raise NotOnCurve("not on this curve")
        return candidate

    def infinity(self):
        return Point(self, None, None)


def double_and_add_trace(point, scalar):
    ref = point.curve._ref()
    rows = []
    accumulator = None
    addend = point._c()
    for index in range(max(scalar.bit_length(), 1)):
        bit = (scalar >> index) & 1
        before_acc, before_add = accumulator, addend
        if bit:
            accumulator = ref.add(accumulator, addend)
        addend = ref.add(addend, addend)
        rows.append({
            "index": index,
            "bit": bit,
            "accumulator_before": _render(before_acc),
            "addend_before": _render(before_add),
            "added": bool(bit),
            "accumulator_after": _render(accumulator),
            "addend_after": _render(addend),
            "on_curve": True,
        })
    return rows
`;

describe("ac26-w3-ec-group: participant contract", () => {
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
      "local/tests/public/test_curve.py",
      "local/tests/hidden/check_curve.py",
      "local/verifier/server.py",
      "local/participant/server.py",
      "local/participant/workbench.py",
      "local/starter/curve.py",
      "local/reference/curve.py",
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

  it("should pass K to docker as a flag, not as the container command", () => {
    // `-e` is a flag of `compose run`, so it has to precede the service name. Putting it
    // after would make docker read `K=...` as the command to run in the container.
    const makefile = read("Makefile");
    const runInspect = makefile.slice(
      makefile.indexOf("RUN_INSPECT :="),
      makefile.indexOf(".PHONY:"),
    );
    expect(runInspect).toContain("-e K=$(K)");
    expect(runInspect.indexOf("-e K=$(K)")).toBeLessThan(runInspect.indexOf("workbench"));
  });

  it("should bring the verifier up for every target that needs public evidence", () => {
    // Since the split `show.py` and the public tests read this deployment's public half
    // over the compose network, so a bare `docker run` against the participant image
    // cannot serve them any more.
    const makefile = read("Makefile");
    for (const target of ["test: build verifier-up", "inspect: build verifier-up"]) {
      expect(makefile).toContain(target);
    }
    expect(makefile).toContain("verifier-up:");
    expect(makefile).toContain("verifier-down:");
  });
});

describe("ac26-w3-ec-group: container safety", () => {
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

describe("ac26-w3-ec-group: the fixtures make the exceptional cases reachable", () => {
  // Both properties are load-bearing. A singular curve is not a group at all, and a
  // curve with no y = 0 point never exercises the vertical tangent — the `double`
  // checkpoint would then grade nothing it claims to.
  it("should only offer non-singular curves that have a vertical-tangent point", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TOY_CURVES, order_two_points",
      "bad = []",
      "for p, a, b in TOY_CURVES:",
      "    disc = (-16 * (4 * a ** 3 + 27 * b ** 2)) % p",
      "    if disc == 0 or not order_two_points(p, a, b):",
      "        bad.append((p, a, b))",
      "print(len(TOY_CURVES), bad)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("7 []");
  });

  // The whole point of the title. If no offered curve contained (0, 0), the identity
  // checkpoint would be testing a rule with no teeth.
  it("should offer curves on which (0, 0) is a real point", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import TOY_CURVES, points_on",
      "with_zero = [c for c in TOY_CURVES if (0, 0) in points_on(*c)]",
      "print(len(with_zero))",
    ].join("\n");
    expect(Number(python(["-c", script]).stdout.trim())).toBeGreaterThanOrEqual(6);
  });

  it("should produce different curves for different seeds", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import curve_params, health_token",
      "s = sys.argv[1]",
      "print(json.dumps([curve_params(s), health_token(s)]))",
    ].join("\n");
    const first = python(["-c", script, "seed-alpha"]).stdout.trim();
    const second = python(["-c", script, "seed-gamma"]).stdout.trim();
    const again = python(["-c", script, "seed-alpha"]).stdout.trim();
    expect(first).toBe(again);
    expect(new Set([first, second]).size).toBeGreaterThanOrEqual(1);
  });

  it("should include the scalars most likely to be got wrong", () => {
    const script = [
      "import sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import scalars",
      "ks = scalars('s0', 'h0')",
      "print(0 in ks, 1 in ks)",
    ].join("\n");
    expect(python(["-c", script]).stdout.trim()).toBe("True True");
  });
});

describe("ac26-w3-ec-group: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_curve.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect in the mutation suite", () => {
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.status).toBe(0);
  });
});

describe("ac26-w3-ec-group: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    120_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    120_000,
  );

  // The defect the problem is named after.
  it("should reject an implementation that represents the identity as (0, 0)", () => {
    const source = bundle("reference")
      .replace(
        "        return self.x is None and self.y is None",
        "        return (self.x, self.y) == (0, 0)",
      )
      .replace("        return Point(self, None, None)", "        return Point(self, 0, 0)");
    expect(source).toContain("(self.x, self.y) == (0, 0)");
    expect(evaluate("identity", source)).toBe(false);
  }, 120_000);

  // Doubling written as a special case of the chord formula. It is right nowhere, but
  // an implementation that never doubles in its own tests will not notice.
  it("should reject doubling that uses the chord's numerator", () => {
    const source = bundle("reference").replace(
      "(3 * self.x * self.x + self.curve.a)",
      "(other.y - self.y)",
    );
    expect(evaluate("double", source)).toBe(false);
  }, 120_000);

  // Same final answer for some scalars, wrong intermediate state for all of them.
  it("should reject a trace that consumes bits most significant first", () => {
    const source = bundle("reference").replace(
      "    rows: list[dict] = []\n    result = point.curve.infinity()",
      "    rows: list[dict] = []\n    scalar = int(f'{scalar:b}'[::-1], 2) if scalar else scalar\n" +
        "    result = point.curve.infinity()",
    );
    expect(source).toContain("[::-1]");
    expect(evaluate("trace", source)).toBe(false);
  }, 120_000);

  it("should reject an implementation that accepts an off-curve pair", () => {
    const source = bundle("reference").replace(
      "        if not self.contains(candidate):\n" +
        '            raise NotOnCurve(f"({x}, {y}) does not satisfy the curve equation")',
      "        pass",
    );
    expect(evaluate("on-curve", source)).toBe(false);
  }, 120_000);

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("on-curve", "class Curve:\n    def __init__(self, p, a, b):\n        while True:\n            pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("on-curve", "class Curve(:\n")).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("finish-week3", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

describe("ac26-w3-ec-group: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      courseAlignment: { week: number; role: string; sources?: Array<{ kind: string; ref: string }> };
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

  it("should pin the published week 3 lecture and assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(3);
    expect(courseAlignment.role).toBe("mechanism");
    expect(courseAlignment.sources?.map((source) => source.kind)).toEqual([
      "lecture",
      "assignment",
      // The lecture itself. Pinning only the README meant course:drift watched a 3 KB
      // summary while the 106-slide deck it summarises could change unnoticed.
      "slide",
    ]);
    for (const source of courseAlignment.sources ?? []) {
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(status).toBe("draft");
  });
});

const REPO = join(import.meta.dir, "..");
const DIR = "challenges/ac26-w3-ec-group";

describe("ac26-w3-ec-group: the participant image carries nothing that grades", () => {
  it("keeps fixtures/, the hidden suite and the verifier out of the participant Docker stage", () => {
    const dockerfile = read("local/Dockerfile");
    const participantStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS participant"),
      dockerfile.indexOf("FROM base AS verifier"),
    );
    expect(participantStage).not.toContain("COPY fixtures/");
    expect(participantStage).not.toContain("tests/hidden");
    expect(participantStage).not.toContain("COPY verifier/");
    expect(participantStage).not.toContain("COPY reference/");
    expect(participantStage).not.toContain("COPY mutation.py");
    expect(participantStage).toContain("COPY tests/public/");
    expect(participantStage).toContain("COPY participant/");

    const verifierStage = dockerfile.slice(
      dockerfile.indexOf("FROM base AS verifier"),
      dockerfile.indexOf("FROM participant AS author"),
    );
    expect(verifierStage).toContain("COPY fixtures/");
    expect(verifierStage).toContain("COPY tests/hidden/");
    expect(verifierStage).toContain("COPY verifier/");
    // Unlike ac26-w2-private-aggregate there is no supplied half here: the starter asks
    // the learner to build every name the hidden suite calls, so the verifier stage must
    // not pull `participant/` in at all.
    expect(verifierStage).not.toContain("COPY participant/");
    expect(verifierStage).not.toContain("COPY reference/");
    expect(verifierStage).not.toContain("COPY mutation.py");
  });

  it("reproduces the original leak: no file the participant image carries reaches the derivation or the group law", () => {
    // The file list comes from the Dockerfile's participant stage, via the same
    // derivation `check-answer-reachability.ts` uses, rather than being restated here --
    // so a COPY that puts `fixtures/` or `tests/hidden/` back fails this test.
    const participantFiles = participantPythonFiles(REPO, DIR);
    expect(participantFiles).not.toContain(`${DIR}/local/fixtures/generate.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/tests/hidden/check_curve.py`);
    expect(participantFiles).not.toContain(`${DIR}/local/verifier/server.py`);
    expect(participantFiles).toContain(`${DIR}/local/tests/public/test_curve.py`);
    expect(participantFiles).toContain(`${DIR}/local/participant/server.py`);
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
    const compose = parseYaml(read("local/docker-compose.yml")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["verifier", "workbench"]);
    // The published port and the /verify URL are what metadata.json's runtime declares,
    // and they did not move: the Workbench answers on 18101 and forwards inward.
    expect(compose.services.workbench.ports).toEqual(["127.0.0.1:18101:18101"]);
    expect(compose.services.verifier.ports).toBeUndefined();
    expect(compose.networks.lab.internal).toBe(true);
    expect(compose.services.verifier.networks).toEqual(["lab"]);
    const runtime = JSON.parse(read("metadata.json")).runtime as { verifyUrl: string };
    expect(runtime.verifyUrl).toBe("http://127.0.0.1:18101/verify");
  });
});

describe("ac26-w3-ec-group: what the split does and does not close", () => {
  it("scores zero for a submission that imports the graded material at grading time", () => {
    // Issue 591: `fixtures/` and `tests/hidden/` are on the runner's sys.path because
    // grading needs them, so the guard in verifier/server.py's RUNNER -- not the Docker
    // split -- is what closes this path. Measured, not assumed.
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, "from fixtures.generate import *\n")).toBe(false);
    }
  }, 300_000);

  it("scores zero for the module the participant image ships", () => {
    // The other probe: the participant reads what their own container carries and
    // pastes it, so the RUNNER guard -- which only blocks `import` -- is not in the
    // path. The reference passing every checkpoint above is this probe's positive
    // control (docs/AGENT_LOOP_CONSTRAINTS.md §5), because the guard-removal control is
    // flat here: nothing the participant stage ships defines Curve or Point, so without
    // the reference a silently broken probe would report the same zero.
    const shipped = readFileSync(join(LOCAL, "participant", "workbench.py"), "utf8");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, shipped)).toBe(false);
    }
  }, 300_000);

  it("scores the whole problem for a submission transcribed out of the hidden checker", () => {
    // The third probe (docs/AGENT_LOOP_CONSTRAINTS.md §5, as on ac26-w2-privacy-audit):
    // neither standard probe says anything here, because the leaked material is a class
    // nobody imports by name. `_ReferenceCurve` is a complete group law, so a submission
    // that copies it and wires it to the starter's declared API passes everything.
    //
    // This is what the split closes, and it is asserted from the checker's own source so
    // the test cannot drift from it: the transcription still scores, and the file it was
    // transcribed from is no longer in the participant image (the test above).
    const checker = readFileSync(join(LOCAL, "tests", "hidden", "check_curve.py"), "utf8");
    const transcribed = checker.slice(
      checker.indexOf("class _ReferenceCurve:"),
      checker.indexOf("def _coords(point):"),
    );
    expect(transcribed).toContain("def add(self, left, right):");
    expect(transcribed).toContain("def mul(self, point, scalar: int):");
    const submission = [
      "class NotOnCurve(Exception):\n    pass",
      "class CurveMismatch(Exception):\n    pass",
      transcribed,
      'def _render(coords):\n    return "O" if coords is None else f"({coords[0]}, {coords[1]})"',
      TRANSCRIBED_WRAPPER,
    ].join("\n\n");
    for (const checkpoint of CHECKPOINTS) {
      expect(evaluate(checkpoint, submission)).toBe(true);
    }
  }, 300_000);
});

describe("ac26-w3-ec-group: the public half survives the split", () => {
  it("serves show.py and the public tests every value they used to import", () => {
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, curve_params, points_on",
      "from fixtures.generate import order_two_points, health_token, sample_points, scalars",
      "seed = sys.argv[1]",
      "payload = public_payload(seed)",
      "p, a, b = curve_params(seed)",
      "print(json.dumps({",
      "  'params': payload['params'] == {'p': p, 'a': a, 'b': b},",
      "  'points': payload['points'] == [list(c) for c in points_on(p, a, b)],",
      "  'orderTwo': payload['orderTwoPoints'] == [list(c) for c in order_two_points(p, a, b)],",
      "  'health': payload['healthToken'] == health_token(seed),",
      // The seed derivation is the half that must not travel: the graded labels pick a
      // different curve, different sample points and different scalars from the same
      // seed, and the public label's own points are ones the public tests receive anyway.
      "  'withheld': not ({'samplePoints', 'scalars', 'labels', 'secp256k1'} & set(payload)),",
      "  'labelled': any(curve_params(seed, l) != (p, a, b) for l in ('h0', 'h1', 'h2')),",
      "  'noSamples': all(",
      "      [list(c) for c in sample_points(seed, l)] != payload['points'] for l in ('h0','h1','h2')",
      "  ),",
      "  'noScalars': scalars(seed, 'h0') not in payload.values(),",
      "}))",
    ].join("\n");
    const result = python(["-c", script, SEED]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}")).toEqual({
      params: true,
      points: true,
      orderTwo: true,
      health: true,
      withheld: true,
      labelled: true,
      noSamples: true,
      noScalars: true,
    });
  });

  it("prints exactly what it printed before the split, on every seed shape", () => {
    // show.py reads `GET /public` now instead of importing `fixtures.generate`. What a
    // learner sees must not have moved with it, so the payload path is compared against
    // the derivation directly across seeds spanning every toy curve the generator can
    // pick.
    const script = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from fixtures.generate import public_payload, curve_params, points_on, order_two_points",
      "rows = []",
      "curves = set()",
      "for index in range(60):",
      "    seed = 'show-%d' % index",
      "    payload = public_payload(seed)",
      "    p, a, b = curve_params(seed)",
      "    curves.add((p, a, b))",
      "    rows.append([",
      "        payload['params'] == {'p': p, 'a': a, 'b': b},",
      "        payload['points'] == [list(c) for c in points_on(p, a, b)],",
      "        payload['orderTwoPoints'] == [list(c) for c in order_two_points(p, a, b)],",
      "        len(payload['orderTwoPoints']) > 0,",
      "    ])",
      "print(json.dumps({",
      "  'disagreed': [i for i, row in enumerate(rows) if not all(row)],",
      "  'curves': len(curves),",
      "}))",
    ].join("\n");
    const result = python(["-c", script]);
    expect(result.status).toBe(0);
    const seen = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "null");
    expect(seen.disagreed).toEqual([]);
    expect(seen.curves).toBe(7);
  });

  it("tells a learner which service is missing when the verifier is not running", () => {
    // show.py inside a participant image has no `fixtures/` to fall back to, so an
    // unreachable verifier must say so rather than raise a urllib traceback at somebody
    // trying to read their own fixtures.
    const result = spawnSync("python3", ["show.py"], {
      cwd: LOCAL,
      encoding: "utf8",
      env: {
        ...process.env,
        FLAG_SEED: SEED,
        PYTHONDONTWRITEBYTECODE: "1",
        // Nothing listens on the discard port.
        VERIFIER_PUBLIC_URL: "http://127.0.0.1:9/public",
      },
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("cannot reach this deployment's verifier");
    expect(result.stderr).toContain("make verifier-up");
  });
});
