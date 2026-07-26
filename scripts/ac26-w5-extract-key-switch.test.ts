import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-extract-key-switch takes one coefficient out of a blind-rotation accumulator as an
 * LWE sample, then moves it to another key and dimension. Four properties carry the design
 * and all four are asserted here rather than argued in a comment.
 *
 * **Extraction preserves the phase at every coefficient index.** A mask slot wraps only when
 * its secret index is above the extracted one, so at `degree - 1` nothing wraps at all: an
 * implementation that ignores the negacyclic sign is correct there and nowhere else, and
 * passes anything that checks a single index -- including all four public tests, which use
 * that index and say so.
 *
 * **The extracted dimension and the target dimension differ in every parameter set.** If
 * they matched, a switch that ignored the target entirely would still produce a
 * plausibly-shaped answer.
 *
 * **The whole pipeline stays decryptable.** Blind rotation's noise plus the switch's has to
 * fit the tolerated interval, or a correct submission fails. `VIABLE` is enumerated for
 * exactly this reason.
 *
 * **No artifact-producing function is given a secret.** That is what makes a leak
 * structurally impossible rather than merely tested against, so it is asserted on the
 * source rather than assumed.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w5-extract-key-switch");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
const CHECKPOINTS = [
  "phase",
  "extract",
  "trace",
  "decompose",
  "switch",
  "domains",
  "endtoend",
  "transfer",
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
  return read(`local/${dir}/extract.py`);
}

/** Last stdout line of a stdlib-only snippet run inside local/. */
function probe(lines: string[]): string {
  const result = python(["-c", ["import sys", "sys.path.insert(0, '.')", ...lines].join("\n")]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim().split("\n").at(-1) ?? "";
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

describe("ac26-w5-extract-key-switch: participant contract", () => {
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
      "local/tests/public/test_extract.py",
      "local/tests/hidden/check_extract.py",
      "local/verifier/server.py",
      "local/starter/extract.py",
      "local/reference/extract.py",
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
});

describe("ac26-w5-extract-key-switch: container safety", () => {
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

  it("should bound the verifier itself, not only the submission it runs", () => {
    const compose = read("local/docker-compose.yml");
    expect(compose).toContain("mem_limit:");
    expect(compose).toContain("pids_limit:");
  });

  it("should never build a shell command out of participant input", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).toContain("shell=False");
    expect(verifier).not.toContain("os.system");
    expect(verifier).not.toContain("shell=True");
  });
});

describe("ac26-w5-extract-key-switch: the whole pipeline stays decryptable", () => {
  it("should keep blind rotation's noise plus the switch's inside the budget", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import VIABLE, noise_bound",
      "bad = []",
      "for base, levels, degree, dimension, target in VIABLE:",
      "    q = base ** levels",
      "    par = {'base': base, 'levels': levels, 'degree': degree, 'dimension': dimension,",
      "           'target_dimension': target, 'modulus': q, 'plaintext_modulus': 4,",
      "           'delta': q // 4}",
      "    if noise_bound(par) * 2 >= par['delta'] // 2:",
      "        bad.append([base, levels, degree, dimension, noise_bound(par), par['delta'] // 2])",
      "print(json.dumps(bad))",
    ]);
    // Twice the bound, so the margin is real rather than marginal.
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should only draw parameter sets from that enumerated list", () => {
    const answer = probe([
      "from fixtures.generate import VIABLE, params",
      "drawn = {(p['base'], p['levels'], p['degree'], p['dimension'], p['target_dimension'])",
      "         for p in (params('s', f'L{i}') for i in range(40))}",
      "print(drawn <= set(VIABLE))",
    ]);
    expect(answer).toBe("True");
  });

  it("should never make the target dimension equal the extracted one", () => {
    // They are the ring degree and the target key's length. If they matched, a switch that
    // ignored the target entirely would still produce a plausibly-shaped answer.
    const answer = probe([
      "from fixtures.generate import VIABLE",
      "print(all(degree != target for _, _, degree, _, target in VIABLE))",
    ]);
    expect(answer).toBe("True");
  });

  it("should draw both bases and more than one ring degree across seeds", () => {
    const answer = probe([
      "from fixtures.generate import params",
      "drawn = [params(s, f'L{i}') for s in 'abcdef' for i in range(8)]",
      "print(sorted({p['base'] for p in drawn}), len({p['degree'] for p in drawn}) > 1)",
    ]);
    expect(answer).toBe("[2, 4] True");
  });
});

describe("ac26-w5-extract-key-switch: extraction preserves the phase everywhere", () => {
  it("should hold at every coefficient index on a real blind-rotation accumulator", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (extract_sample, lwe_phase_of, params,",
      "    phase_coefficient, rlwe_secret, rotated_accumulator)",
      "bad = []",
      "for i in range(9):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    for k in range(par['degree']):",
      "        got = lwe_phase_of(par, ring, extract_sample(par, acc, k))",
      "        if got != phase_coefficient(par, ring, acc, k):",
      "            bad.append([i, k])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should be indistinguishable from a sign-blind extraction at the last index only", () => {
    // The property the problem is built around. A slot wraps only when its secret index is
    // above the extracted one, so at `degree - 1` nothing wraps and a sign-blind extraction
    // is right there -- and wrong at every other index, index 0 most of all.
    const answer = probe([
      "import json",
      "from fixtures.generate import (lwe_phase_of, params, phase_coefficient,",
      "    rlwe_secret, rotated_accumulator)",
      "def blind(par, ct, k):",
      "    n = par['degree']",
      "    a = list(ct['a'])",
      "    mask = tuple(a[k - j] if j <= k else a[k - j + n] for j in range(n))",
      "    return {'mask': mask, 'body': list(ct['b'])[k]}",
      "agree, differ, total = 0, 0, 0",
      "for i in range(9):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    for k in range(par['degree']):",
      "        same = lwe_phase_of(par, ring, blind(par, acc, k)) == phase_coefficient(par, ring, acc, k)",
      "        if k == par['degree'] - 1:",
      "            agree += int(same)",
      "            total += 1",
      "        else:",
      "            differ += int(not same)",
      "print(json.dumps([agree, differ, total]))",
    ]);
    const [agreeAtLast, differElsewhere, total] = JSON.parse(answer) as [number, number, number];
    expect(agreeAtLast).toBe(total);
    expect(total).toBe(9);
    expect(differElsewhere).toBeGreaterThan(0);
  });

  it("should add no noise, so the extracted phase is the coefficient exactly", () => {
    const answer = probe([
      "from fixtures.generate import (extract_sample, lwe_phase_of, params,",
      "    phase_coefficient, rlwe_secret, rotated_accumulator)",
      "ok = True",
      "for i in range(9):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    ok = ok and all(lwe_phase_of(par, ring, extract_sample(par, acc, k))",
      "                    == phase_coefficient(par, ring, acc, k) for k in range(par['degree']))",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-extract-key-switch: key switching keeps the message", () => {
  it("should agree across the coefficient, the extracted sample and the switched one", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (decode, extract_sample, key_id, key_switch, lwe_decrypt,",
      "    params, phase_coefficient, rlwe_secret, rotated_accumulator, switching_key,",
      "    target_secret)",
      "bad = []",
      "for i in range(9):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    tgt = target_secret('s', par, f't{i}')",
      "    sid, tid = key_id('s', f'r{i}'), key_id('s', f't{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    ksk = switching_key('s', par, ring, tgt, sid, tid, f'k{i}')",
      "    for k in range(par['degree']):",
      "        sample = dict(extract_sample(par, acc, k)); sample['keyId'] = sid",
      "        out = key_switch(par, ksk, sample)",
      "        three = {decode(par, phase_coefficient(par, ring, acc, k)),",
      "                 lwe_decrypt(par, ring, sample), lwe_decrypt(par, tgt, out)}",
      "        if len(three) != 1:",
      "            bad.append([i, k, sorted(three)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should refuse a switching key built for a different source key", () => {
    const answer = probe([
      "from fixtures.generate import (extract_sample, key_id, key_switch, params,",
      "    rlwe_secret, rotated_accumulator, switching_key, target_secret)",
      "refused = 0",
      "for i in range(6):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    other = rlwe_secret('s', par, f'o{i}')",
      "    tgt = target_secret('s', par, f't{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    wrong = switching_key('s', par, other, tgt, key_id('s', f'o{i}'), key_id('s', f't{i}'), f'w{i}')",
      "    sample = dict(extract_sample(par, acc, 0)); sample['keyId'] = key_id('s', f'r{i}')",
      "    try:",
      "        key_switch(par, wrong, sample)",
      "    except ValueError:",
      "        refused += 1",
      "print(refused)",
    ]);
    expect(answer).toBe("6");
  });

  it("should land the result on the target key's own dimension and id", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (extract_sample, key_id, key_switch, params,",
      "    rlwe_secret, rotated_accumulator, switching_key, target_secret)",
      "bad = []",
      "for i in range(9):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    tgt = target_secret('s', par, f't{i}')",
      "    sid, tid = key_id('s', f'r{i}'), key_id('s', f't{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    ksk = switching_key('s', par, ring, tgt, sid, tid, f'k{i}')",
      "    sample = dict(extract_sample(par, acc, 0)); sample['keyId'] = sid",
      "    out = key_switch(par, ksk, sample)",
      "    if len(out['mask']) != par['target_dimension'] or out['keyId'] != tid:",
      "        bad.append([i, len(out['mask']), par['target_dimension']])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-extract-key-switch: no artifact-producing function is given a secret", () => {
  // This is what makes "the raw secret ended up in the ciphertext metadata" impossible
  // rather than merely tested against, and it is the reason one candidate mutation was
  // dropped. Asserted on the source so a future signature change is caught.
  it("should hand a key only to phase_coefficient, which returns a single integer", () => {
    const reference = readFileSync(join(LOCAL, "reference", "extract.py"), "utf8");
    const signatures = [...reference.matchAll(/^def (\w+)\(([^)]*)\)/gm)].map(
      (match) => [match[1] as string, match[2] as string] as const,
    );
    const withKeys = signatures
      .filter(([, args]) => /\b(ring_key|secret|target)\b/.test(args))
      .map(([name]) => name);
    expect(withKeys).toEqual(["phase_coefficient"]);
    for (const name of ["extract_sample", "extract_trace", "key_switch", "domain_report"]) {
      expect(signatures.some(([fn]) => fn === name)).toBe(true);
    }
  });

  it("should report the noise as a bound rather than measuring it, since measuring needs a key", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (domain_report, extract_sample, key_id, params,",
      "    rlwe_secret, rotated_accumulator, switching_key, target_secret)",
      "bad = []",
      "for i in range(9):",
      "    par = params('s', f'L{i}')",
      "    ring = rlwe_secret('s', par, f'r{i}')",
      "    tgt = target_secret('s', par, f't{i}')",
      "    sid, tid = key_id('s', f'r{i}'), key_id('s', f't{i}')",
      "    acc = rotated_accumulator('s', par, ring, f'L{i}')",
      "    ksk = switching_key('s', par, ring, tgt, sid, tid, f'k{i}')",
      "    sample = dict(extract_sample(par, acc, 0)); sample['keyId'] = sid",
      "    report = domain_report(par, sample, ksk)",
      "    want = par['degree'] * par['levels'] * (par['base'] - 1)",
      "    if report['noiseAdded'] != want or not report['compatible']:",
      "        bad.append([i, report['noiseAdded'], want])",
      "    if report['sourceKeyId'] == report['targetKeyId']:",
      "        bad.append(['key ids collapsed', i])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-extract-key-switch: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_extract.py"]);
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

describe("ac26-w5-extract-key-switch: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    180_000,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    180_000,
  );

  it("should reject an extraction that is correct only at the last coefficient", () => {
    // Passes every public test. This is the defect the whole problem is shaped around.
    const source = bundle("reference").replace(
      "        (a[index - j] if j <= index else -a[index - j + degree]) % modulus",
      "        (a[index - j] if j <= index else a[index - j + degree]) % modulus",
    );
    expect(evaluate("extract", source)).toBe(false);
  }, 180_000);

  it("should reject a decomposition grouped by level instead of by coefficient", () => {
    const source = bundle("reference").replace(
      "    return tuple(decompose(params, value) for value in mask)",
      "    rows = [decompose(params, value) for value in mask]\n    return tuple(zip(*rows))",
    );
    expect(evaluate("decompose", source)).toBe(false);
  }, 180_000);

  it("should reject a switch that adds the entries instead of subtracting them", () => {
    const source = bundle("reference").replace(
      '                accumulator[i] -= digit * entry["mask"][i]\n'
        + '            body -= digit * entry["body"]',
      '                accumulator[i] += digit * entry["mask"][i]\n'
        + '            body += digit * entry["body"]',
    );
    expect(evaluate("switch", source)).toBe(false);
  }, 180_000);

  it("should reject a switch that applies a key built for a different source", () => {
    const source = bundle("reference").replace(
      '    if sample.get("keyId") is not None and sample["keyId"] != switching_key["sourceKeyId"]:\n'
        + '        raise ValueError("the switching key is for a different source key")',
      "    return",
    );
    expect(evaluate("switch", source)).toBe(false);
  }, 180_000);

  it("should reject a report that confuses the source key with the target", () => {
    const source = bundle("reference").replace(
      '        "sourceKeyId": switching_key["sourceKeyId"],',
      '        "sourceKeyId": switching_key["targetKeyId"],',
    );
    expect(evaluate("domains", source)).toBe(false);
  }, 180_000);

  it("should run transfer under parameters no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("decompose", "def decompose_mask(params, mask):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, 60_000);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("decompose", "def decompose_mask(:\n")).toBe(false);
  }, 60_000);

  it("should reject a verdict printed from an atexit hook", () => {
    const spoof = [
      "import atexit, json",
      'atexit.register(lambda: print(json.dumps({"failures": []})))',
      "",
    ].join("\n");
    expect(evaluate("phase", spoof)).toBe(false);
  }, 60_000);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("bootstrap", bundle("reference"))).toBe(false);
  });

  it("should echo the checkpointId so the platform can fail closed", () => {
    expect(read("local/verifier/server.py")).toContain(
      '{"checkpointId": checkpoint_id, "correct": correct}',
    );
  });
});

/**
 * `evaluate()` is called directly everywhere above, which is how a wrong bind address
 * survives a fully green suite: the scoring logic is perfect and the platform still cannot
 * reach it. A published container port forwards to the container's bridge address, so a
 * server listening on 127.0.0.1 *inside* the container accepts nothing from outside it.
 *
 * Host-side loopback is the compose file's job and is asserted in the container-safety block.
 */
describe("ac26-w5-extract-key-switch: the verifier is reachable, not only correct", () => {
  it("should bind every interface inside the container, not the container's loopback", () => {
    const verifier = read("local/verifier/server.py");
    expect(verifier).not.toMatch(/HTTPServer\(\(\s*["']127\.0\.0\.1["']/);
    expect(verifier).toMatch(/HTTPServer\(\(\s*["']0\.0\.0\.0["']/);
  });

  it("should publish that port on host loopback only, which is where the restriction belongs", () => {
    const metadata = JSON.parse(read("metadata.json"));
    const port = metadata.exposedPorts[0].port as number;
    expect(read("local/docker-compose.yml")).toContain(`"127.0.0.1:${port}:${port}"`);
    expect(metadata.runtime.verifyUrl).toBe(`http://127.0.0.1:${port}/verify`);
  });
});

describe("ac26-w5-extract-key-switch: metadata contracts", () => {
  function metadata() {
    return JSON.parse(read("metadata.json")) as {
      difficulty: number;
      status: string;
      track: { order: number };
      courseAlignment: {
        week: number;
        role: string;
        spoilerPolicy: string;
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
    expect(meta.difficulty).toBe(4);
    expect(meta.scoring.checks.reduce((sum, check) => sum + check.points, 0)).toBe(300);
    for (const check of meta.scoring.checks) {
      const penalty = (check.hints ?? []).reduce((sum, hint) => sum + hint.penalty, 0);
      expect(penalty).toBeLessThanOrEqual(check.points / 2);
    }
  });

  it("should score exactly the checkpoints the verifier implements", () => {
    expect(metadata().scoring.checks.map((check) => check.id)).toEqual([...CHECKPOINTS]);
  });

  it("should sit at order 550, after the blind rotation it consumes", () => {
    expect(metadata().track.order).toBe(550);
  });

  it("should pin week 5's real lecture and assignment, not a placeholder", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(5);
    expect(courseAlignment.role).toBe("mechanism");
    const sources = courseAlignment.sources ?? [];
    expect(sources.map((source) => source.kind).sort()).toEqual(["assignment", "lecture"]);
    for (const source of sources) {
      expect(source.kind).not.toBe("placeholder");
      expect(source.ref).toMatch(/^[0-9a-f]{40}$/);
      expect(source.path.startsWith("week5/")).toBe(true);
    }
    expect(status).toBe("draft");
  });

  it("should declare the independent-reimplementation spoiler policy", () => {
    expect(metadata().courseAlignment.spoilerPolicy).toBe("independent-reimplementation");
  });
});
