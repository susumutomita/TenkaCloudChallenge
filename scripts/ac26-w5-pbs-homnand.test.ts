import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseYaml } from "yaml";

/**
 * ac26-w5-pbs-homnand chains all five Week 5 problems into one Programmable Bootstrapping
 * pipeline and evaluates a NAND on top of it. Five properties carry the design and all five
 * are asserted here rather than argued in a comment.
 *
 * **A correct truth table proves less than it looks.** 21 of the 37 shipped mutations
 * produce a perfect truth table -- every unary function, both messages, all four NAND rows,
 * every parameter set -- and are broken pipelines anyway. That measurement is what justifies
 * ten stage-level checkpoints instead of one end-to-end check, and it is quoted in
 * README.md, README.ja.md and metadata.json, so it is pinned here too.
 *
 * **The refresh is an absence.** The output's noise bound does not mention the input's. The
 * enumerated `VIABLE` list exists so that twice the output bound still fits the correctness
 * bound, which is what makes a second pass possible at all.
 *
 * **The balanced encoding is what makes a lookup table work.** `encode(1) = +q/8` and
 * `encode(0) = -q/8`, so decoding is a sign test and `-encode(x) = encode(1 - x)` -- which
 * is why the table's upper half holds `1 - f(0)`.
 *
 * **The gate is a linear combination.** The identity table is used for all four NAND rows;
 * what separates them is the sign of the combined phase.
 *
 * **No stage function is given a secret.** That is what makes the decrypt-and-re-encrypt
 * shortcut structurally absent rather than merely tested against, so it is asserted on the
 * source rather than assumed.
 *
 * Python 3 is on ubuntu-latest and the problem is stdlib-only.
 */

const ROOT = join(import.meta.dir, "..", "challenges", "ac26-w5-pbs-homnand");
const LOCAL = join(ROOT, "local");
const SEED = "ci-fixed-seed";
/**
 * Eight scored checkpoints over ten graded stage contracts.
 *
 * `tests/hidden/check_pipeline.py` grades all ten stages separately. The multi-verify
 * contract caps a problem at eight checks, catalog-side in SCHEMA.json and again in the
 * platform's `packages/problem-sdk/src/scoring-metadata/multi-verify.ts` -- which returns
 * `undefined` for a ninth rather than truncating, so the whole scoring object is dropped and
 * the problem becomes unscoreable. The caps are deliberately mirrored.
 *
 * So `relabel` runs extraction and the key switch, and `nand` runs the combination and the
 * gate. Both pairs are one idea graded twice, which is why they are the pairs that merged.
 */
const CHECKPOINTS = [
  "lut",
  "domain",
  "rotate",
  "relabel",
  "evaluate",
  "refresh",
  "nand",
  "transfer",
] as const;

/** Every stage the hidden suite grades, whether or not it has a checkpoint of its own. */
const STAGES = [
  "check_lut",
  "check_domain",
  "check_rotate",
  "check_extract",
  "check_switch",
  "check_evaluate",
  "check_refresh",
  "check_combine",
  "check_nand",
] as const;

/** Enough for the whole mutation suite, which loads 37 mutants and measures each twice. */
const SLOW = 300_000;

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function python(args: string[], cwd = LOCAL) {
  return spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FLAG_SEED: SEED, PYTHONDONTWRITEBYTECODE: "1" },
    timeout: SLOW,
  });
}

function bundle(dir: "starter" | "reference"): string {
  return read(`local/${dir}/pipeline.py`);
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

/** Build one parameter set dict inline, so a probe does not depend on the seed's draw. */
const PARAMS_FOR = [
  "def par_for(base, levels, degree, dimension):",
  "    from fixtures.generate import parameter_set_id",
  "    q = base ** levels",
  "    return {'base': base, 'levels': levels, 'degree': degree, 'dimension': dimension,",
  "            'modulus': q, 'plaintext_modulus': 2, 'delta': q // 8,",
  "            'parameterSetId': parameter_set_id(base, levels, degree, dimension),",
  "            'encodingId': 'balanced-eighth'}",
];

describe("ac26-w5-pbs-homnand: participant contract", () => {
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
      "local/tests/public/test_pipeline.py",
      "local/tests/hidden/check_pipeline.py",
      "local/verifier/server.py",
      "local/starter/pipeline.py",
      "local/reference/pipeline.py",
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

describe("ac26-w5-pbs-homnand: container safety", () => {
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
    expect(read("local/Dockerfile")).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}$/m);
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

describe("ac26-w5-pbs-homnand: the pipeline composes", () => {
  it("should leave room for a second bootstrap at every parameter set", () => {
    // The output has to fit back inside the correctness bound or a bootstrapped ciphertext
    // could never be bootstrapped again -- which is the whole claim of the problem. VIABLE
    // is enumerated rather than sampled for exactly this reason.
    const answer = probe([
      "import json",
      "from fixtures.generate import VIABLE, correctness_bound, output_noise_bound",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    if 2 * output_noise_bound(par) > correctness_bound(par):",
      "        bad.append([base, levels, degree, dimension,",
      "                    output_noise_bound(par), correctness_bound(par)])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should leave the domain switch's rounding inside the rotation budget", () => {
    // The switch spends (n+1)/2 of the N/4 units available. If it spent them all there
    // would be no budget left for any input noise at all.
    const answer = probe([
      "import json",
      "from fixtures.generate import VIABLE",
      "bad = [[b, l, d, n] for b, l, d, n in VIABLE if (n + 1) / 2 >= d // 4]",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should only draw parameter sets from that enumerated list", () => {
    const answer = probe([
      "from fixtures.generate import VIABLE, params",
      "drawn = {(p['base'], p['levels'], p['degree'], p['dimension'])",
      "         for p in (params('s', f'L{i}') for i in range(40))}",
      "print(drawn <= set(VIABLE))",
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

describe("ac26-w5-pbs-homnand: the balanced encoding is what makes the lookup work", () => {
  it("should make decoding a sign test, so negacyclic rotation computes it for free", () => {
    const answer = probe([
      "from fixtures.generate import VIABLE, centered, decode, encode",
      ...PARAMS_FOR,
      "ok = True",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    for m in (0, 1):",
      "        ok = ok and decode(par, encode(par, m)) == m",
      "        ok = ok and (centered(par, encode(par, m)) > 0) == (m == 1)",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });

  it("should make negating a codeword the same as flipping the bit", () => {
    // This identity is the whole reason the table's upper half holds `1 - f(0)`: the wrap
    // hands coefficient 0 its value negated, and a balanced encoding turns that into a
    // flipped message rather than into garbage.
    const answer = probe([
      "from fixtures.generate import VIABLE, encode",
      ...PARAMS_FOR,
      "ok = True",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    for m in (0, 1):",
      "        ok = ok and (-encode(par, m)) % par['modulus'] == encode(par, 1 - m)",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });

  it("should give the two bijections a constant table and the two constants a varied one", () => {
    // The negation inverts which functions are interesting. `identity` and `negate` satisfy
    // f(0) + f(1) == 1, so `encode(f(1))` and `encode(1 - f(0))` are the same number and the
    // whole accumulator is constant -- which is why every public test uses `identity` and
    // why it hides so much. `always-zero` and `always-one` are the ones that show the halves.
    const answer = probe([
      "import json",
      "from fixtures.generate import UNARY, VIABLE, lookup_accumulator",
      ...PARAMS_FOR,
      "shape = {}",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    for name, f in UNARY.items():",
      "        distinct = len(set(lookup_accumulator(par, {0: f(0), 1: f(1)})['b']))",
      "        shape.setdefault(name, set()).add(distinct)",
      "print(json.dumps({k: sorted(v) for k, v in sorted(shape.items())}))",
    ]);
    expect(JSON.parse(answer)).toEqual({
      "always-one": [2],
      "always-zero": [2],
      identity: [1],
      negate: [1],
    });
  });
});

describe("ac26-w5-pbs-homnand: PBS evaluates the function and refreshes the key", () => {
  it("should satisfy Dec(PBS_f(Enc(m))) = f(m) for every unary f at every parameter set", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (UNARY, VIABLE, bootstrap, bootstrap_key, key_id,",
      "    lwe_decrypt, lwe_encrypt, lwe_secret, ring_secret, switching_key)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    rk, lk = ring_secret('s', par), lwe_secret('s', par)",
      "    bk = bootstrap_key('s', par, rk, lk)",
      "    sid, tid = key_id('s', 'ring'), key_id('s', 'lwe')",
      "    ksk = switching_key('s', par, rk, lk, sid, tid, 'ks')",
      "    for name, f in UNARY.items():",
      "        for m in (0, 1):",
      "            ct = lwe_encrypt('s', par, lk, m, f'{name}{m}')",
      "            out = bootstrap(par, bk, ksk, ct, {0: f(0), 1: f(1)})",
      "            if lwe_decrypt(par, lk, out) != f(m):",
      "                bad.append([par['parameterSetId'], name, m])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should return a ciphertext under the input's own key, so the output goes back in", () => {
    // Not a detail: if the output landed under any other secret it could not be an input to
    // the next gate, and nothing after the first gate in a circuit would be possible.
    const answer = probe([
      "import json",
      "from fixtures.generate import (VIABLE, bootstrap, bootstrap_key, key_id, lwe_decrypt,",
      "    lwe_encrypt, lwe_secret, ring_secret, switching_key)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    rk, lk = ring_secret('s', par), lwe_secret('s', par)",
      "    bk = bootstrap_key('s', par, rk, lk)",
      "    sid, tid = key_id('s', 'ring'), key_id('s', 'lwe')",
      "    ksk = switching_key('s', par, rk, lk, sid, tid, 'ks')",
      "    first = bootstrap(par, bk, ksk, lwe_encrypt('s', par, lk, 1, 'c'), {0: 1, 1: 0})",
      "    second = bootstrap(par, bk, ksk, first, {0: 1, 1: 0})",
      "    if first['keyId'] != tid or len(first['mask']) != dimension:",
      "        bad.append([par['parameterSetId'], 'domain'])",
      "    if lwe_decrypt(par, lk, second) != 1:",
      "        bad.append([par['parameterSetId'], 'second pass'])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should refresh: an input carrying half the correctness bound still comes out right", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (VIABLE, bootstrap, bootstrap_key, correctness_bound,",
      "    key_id, lwe_decrypt, lwe_encrypt, lwe_secret, ring_secret, switching_key)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    rk, lk = ring_secret('s', par), lwe_secret('s', par)",
      "    bk = bootstrap_key('s', par, rk, lk)",
      "    sid, tid = key_id('s', 'ring'), key_id('s', 'lwe')",
      "    ksk = switching_key('s', par, rk, lk, sid, tid, 'ks')",
      "    for m in (0, 1):",
      "        noisy = lwe_encrypt('s', par, lk, m, f'noisy{m}',",
      "                            error=correctness_bound(par) // 2)",
      "        if lwe_decrypt(par, lk, bootstrap(par, bk, ksk, noisy, {0: 0, 1: 1})) != m:",
      "            bad.append([par['parameterSetId'], m])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should report an output bound that does not vary with the input's noise", () => {
    // The refresh, as an equation rather than a paragraph. If this number moved with the
    // input, a second pass could not be guaranteed and circuits would be impossible.
    const answer = probe([
      "from fixtures.generate import VIABLE, refresh_report",
      ...PARAMS_FOR,
      "ok = True",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    bounds = {refresh_report(par, e)['outputNoiseBound'] for e in (0, 1, 7, 10_000)}",
      "    ok = ok and len(bounds) == 1",
      "    ok = ok and refresh_report(par, 0)['secondPassFits']",
      "print(ok)",
    ]);
    expect(answer).toBe("True");
  });
});

describe("ac26-w5-pbs-homnand: the gate is a linear combination", () => {
  it("should complete the NAND truth table at every parameter set", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (VIABLE, bootstrap_key, homomorphic_nand, key_id,",
      "    lwe_decrypt, lwe_encrypt, lwe_secret, ring_secret, switching_key)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    rk, lk = ring_secret('s', par), lwe_secret('s', par)",
      "    bk = bootstrap_key('s', par, rk, lk)",
      "    sid, tid = key_id('s', 'ring'), key_id('s', 'lwe')",
      "    ksk = switching_key('s', par, rk, lk, sid, tid, 'ks')",
      "    for x in (0, 1):",
      "        for y in (0, 1):",
      "            c1 = lwe_encrypt('s', par, lk, x, f'{x}{y}l')",
      "            c2 = lwe_encrypt('s', par, lk, y, f'{x}{y}r')",
      "            got = lwe_decrypt(par, lk, homomorphic_nand(par, bk, ksk, c1, c2))",
      "            if got != 1 - (x & y):",
      "                bad.append([par['parameterSetId'], x, y, got])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should put the gate in the combination's sign rather than in the lookup table", () => {
    // All four rows use the identity table. What separates them is the sign of the phase
    // the pre-processing produced, and `(1,1)` is the only negative one.
    const answer = probe([
      "import json",
      "from fixtures.generate import (VIABLE, bootstrap_key, centered, key_id, lwe_encrypt,",
      "    lwe_phase, lwe_secret, nand_combine, ring_secret)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    lk = lwe_secret('s', par)",
      "    for x in (0, 1):",
      "        for y in (0, 1):",
      "            c1 = lwe_encrypt('s', par, lk, x, f'p{x}{y}l')",
      "            c2 = lwe_encrypt('s', par, lk, y, f'p{x}{y}r')",
      "            phase = centered(par, lwe_phase(par, lk, nand_combine(par, c1, c2)))",
      "            if (phase > 0) != bool(1 - (x & y)):",
      "                bad.append([par['parameterSetId'], x, y, phase])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });

  it("should separate the two boundary rows only because of the offset", () => {
    // Without the q/8 term, (0,1) and (1,0) have a phase of exactly the noise -- which is
    // why dropping it fails those two rows intermittently rather than always.
    const answer = probe([
      "import json",
      "from fixtures.generate import (VIABLE, centered, lwe_encrypt, lwe_phase, lwe_secret)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    lk = lwe_secret('s', par)",
      "    for x, y in ((0, 1), (1, 0)):",
      "        c1 = lwe_encrypt('s', par, lk, x, f'o{x}{y}l')",
      "        c2 = lwe_encrypt('s', par, lk, y, f'o{x}{y}r')",
      "        without = centered(par, (-lwe_phase(par, lk, c1) - lwe_phase(par, lk, c2))",
      "                           % par['modulus'])",
      "        if abs(without) > 4:",
      "            bad.append([par['parameterSetId'], x, y, without])",
      "print(json.dumps(bad))",
    ]);
    // Only the drawn noise is left, so the row sits on the decision boundary.
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-pbs-homnand: no stage function is given a secret", () => {
  // This is what makes "decrypt the input, apply f, re-encrypt" impossible rather than
  // merely tested against, and it is the reason two candidate mutations were dropped.
  // Asserted on the source so a future signature change is caught.
  it("should hand no key to any stage in the reference implementation", () => {
    const reference = readFileSync(join(LOCAL, "reference", "pipeline.py"), "utf8");
    const signatures = [...reference.matchAll(/^def (\w+)\(([^)]*)\)/gm)].map(
      (match) => [match[1] as string, match[2] as string] as const,
    );
    const withSecrets = signatures
      .filter(([, args]) => /\b(ring_key|lwe_key|secret)\b/.test(args))
      .map(([name]) => name);
    expect(withSecrets).toEqual([]);
    for (const name of [
      "lookup_accumulator",
      "to_rotation_domain",
      "blind_rotate",
      "extract",
      "switch",
      "bootstrap",
      "pipeline_trace",
      "nand_combine",
      "homomorphic_nand",
    ]) {
      expect(signatures.some(([fn]) => fn === name)).toBe(true);
    }
  });

  it("should keep the trace's noise figures as bounds, since measuring one needs a key", () => {
    const answer = probe([
      "import json",
      "from fixtures.generate import (VIABLE, blind_rotation_noise, bootstrap_key,",
      "    correctness_bound, key_id, key_switch_noise, lwe_encrypt, lwe_secret,",
      "    output_noise_bound, pipeline_trace, ring_secret, switching_key)",
      ...PARAMS_FOR,
      "bad = []",
      "for base, levels, degree, dimension in VIABLE:",
      "    par = par_for(base, levels, degree, dimension)",
      "    rk, lk = ring_secret('s', par), lwe_secret('s', par)",
      "    bk = bootstrap_key('s', par, rk, lk)",
      "    sid, tid = key_id('s', 'ring'), key_id('s', 'lwe')",
      "    ksk = switching_key('s', par, rk, lk, sid, tid, 'ks')",
      "    rows = pipeline_trace(par, bk, ksk, lwe_encrypt('s', par, lk, 1, 't'), {0: 0, 1: 1})",
      "    want = [correctness_bound(par), (dimension + 1) // 2, 0,",
      "            blind_rotation_noise(par), blind_rotation_noise(par), output_noise_bound(par)]",
      "    if [r['noiseBound'] for r in rows] != want:",
      "        bad.append([par['parameterSetId'], [r['noiseBound'] for r in rows], want])",
      "    if [r['carriesMessage'] for r in rows].count(False) != 1:",
      "        bad.append([par['parameterSetId'], 'accumulator is the only message-free row'])",
      "print(json.dumps(bad))",
    ]);
    expect(JSON.parse(answer)).toEqual([]);
  });
});

describe("ac26-w5-pbs-homnand: the problem is solvable and actually fails", () => {
  it("should fail the public tests in the shipped starter state", () => {
    const result = python(["tests/public/test_pipeline.py"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("failed");
  });

  it("should kill every intended defect, and keep the count the docs quote", () => {
    // One run rather than two: the suite loads 37 mutants and measures each twice, so it is
    // the most expensive thing in this file and CI's validate job is capped at 25 minutes.
    //
    // 21 of the 37 produce a perfect truth table and are broken anyway. That number is what
    // justifies ten stage-level checkpoints instead of one end-to-end check, and it appears
    // in README.md, README.ja.md and metadata.json -- so it is pinned rather than trusted.
    const result = python(["mutation.py"]);
    expect(result.stdout).toContain("PASS reference implementation passes the hidden tests");
    expect(result.stdout).not.toContain("SURVIVED");
    expect(result.stdout).toContain("TRUTH-TABLE-BLIND 21 of 37");
    expect(result.status).toBe(0);
    for (const file of ["README.md", "README.ja.md"]) {
      expect(read(file)).toMatch(/\b21\b/);
    }
    expect(read("local/mutation.py")).toContain("TRUTH_TABLE_BLIND = 21");
  }, SLOW);
});

describe("ac26-w5-pbs-homnand: /verify contract", () => {
  it.each(CHECKPOINTS)(
    "should accept the reference submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("reference"))).toBe(true);
    },
    SLOW,
  );

  it.each(CHECKPOINTS)(
    "should reject the starter submission on %s",
    (checkpoint) => {
      expect(evaluate(checkpoint, bundle("starter"))).toBe(false);
    },
    SLOW,
  );

  it("should reject a lookup table whose upper half is not negated", () => {
    const source = bundle("reference").replace(
      "else encode(params, 1 - table[0])",
      "else encode(params, table[0])",
    );
    expect(evaluate("lut", source)).toBe(false);
  }, SLOW);

  it("should reject a rescaling that truncates instead of rounding", () => {
    // This one produces a perfect truth table. It is only visible at its own stage.
    const source = bundle("reference").replace(
      "        return ((value % q) * modulus + q // 2) // q % modulus",
      "        return ((value % q) * modulus) // q % modulus",
    );
    expect(evaluate("domain", source)).toBe(false);
  }, SLOW);

  it("should reject a rotation whose CMUX arguments are the wrong way round", () => {
    const source = bundle("reference").replace(
      "            params, bootstrap_key[index], current, rotate_ciphertext(params, current, mask)",
      "            params, bootstrap_key[index], rotate_ciphertext(params, current, mask), current",
    );
    expect(evaluate("rotate", source)).toBe(false);
  }, SLOW);

  it("should reject an extraction that keeps the input's key id", () => {
    // Right numbers, wrong domain -- and a perfect truth table.
    const source = bundle("reference").replace(
      '        "keyId": rotated["keyId"],\n        "dimension": params["degree"],',
      '        "keyId": rotated["keyId"],\n        "dimension": params["dimension"],',
    );
    expect(evaluate("relabel", source)).toBe(false);
  }, SLOW);

  it("should reject a switch that applies a key built for a different source", () => {
    const source = bundle("reference").replace(
      "    _require_compatible(params, switching_key, sample)\n    switched",
      "    switched",
    );
    expect(evaluate("relabel", source)).toBe(false);
  }, SLOW);

  it("should reject a trace that reports no noise anywhere", () => {
    const source = bundle("reference").replace(
      '             correctness_bound(params), True, "m", "whole", lwe_digest(sample)),',
      '             0, True, "m", "whole", lwe_digest(sample)),',
    );
    expect(evaluate("refresh", source)).toBe(false);
  }, SLOW);

  it("should reject a combination missing the offset that separates the middle rows", () => {
    const source = bundle("reference").replace(
      '        "body": (params["delta"] - left["body"] - right["body"]) % modulus,',
      '        "body": (-left["body"] - right["body"]) % modulus,',
    );
    expect(evaluate("nand", source)).toBe(false);
  }, SLOW);

  it("should reject a gate that returns a constant 1, which is three rows of four", () => {
    const source = bundle("reference").replace(
      "    return bootstrap(\n"
        + '        params, bootstrap_key, switching_key, nand_combine(params, left, right), {0: 0, 1: 1}\n'
        + "    )",
      "    return bootstrap(\n"
        + "        params, bootstrap_key, switching_key,\n"
        + '        {**left, "body": (left["body"] * 0 + params["delta"]) % params["modulus"],\n'
        + '         "mask": tuple(0 for _ in left["mask"])},\n'
        + "        {0: 0, 1: 1},\n"
        + "    )",
    );
    expect(evaluate("nand", source)).toBe(false);
  }, SLOW);

  it("should run transfer under parameters no other checkpoint used", () => {
    expect(read("local/verifier/server.py")).toContain('f"{SEED}:transfer"');
  });

  it("should reject a submission that hangs, rather than hanging itself", () => {
    expect(
      evaluate("domain", "def to_rotation_domain(params, sample):\n    while True:\n        pass\n"),
    ).toBe(false);
  }, SLOW);

  it("should reject a submission that cannot even be imported", () => {
    expect(evaluate("domain", "def to_rotation_domain(:\n")).toBe(false);
  }, SLOW);

  it("should reject a verdict printed from an atexit hook", () => {
    const spoof = [
      "import atexit, json",
      'atexit.register(lambda: print(json.dumps({"failures": []})))',
      "",
    ].join("\n");
    expect(evaluate("lut", spoof)).toBe(false);
  }, SLOW);

  it("should reject an unknown checkpoint id instead of crediting it", () => {
    expect(evaluate("homnand", bundle("reference"))).toBe(false);
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
describe("ac26-w5-pbs-homnand: the verifier is reachable, not only correct", () => {
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

describe("ac26-w5-pbs-homnand: metadata contracts", () => {
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

  it("should total 300 points across its checkpoints", () => {
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

  it("should grade all ten stages, even though only eight are scored", () => {
    // The cap is eight. Ten stage contracts still get their own failure messages; two
    // checkpoints each run a pair. If a stage were dropped rather than paired, the problem
    // would quietly stop checking it.
    const verifier = read("local/verifier/server.py");
    for (const stage of STAGES) expect(verifier).toContain(`"${stage}"`);
    expect(verifier).toContain('"relabel": ("check_extract", "check_switch")');
    expect(verifier).toContain('"nand": ("check_combine", "check_nand")');
    const hidden = read("local/tests/hidden/check_pipeline.py");
    for (const stage of STAGES) expect(hidden).toContain(`def ${stage}(`);
  });

  it("should sit at order 560, after the five problems it consumes", () => {
    expect(metadata().track.order).toBe(560);
  });

  it("should declare itself a synthesis of week 5 against the real lecture and assignment", () => {
    const { courseAlignment, status } = metadata();
    expect(courseAlignment.week).toBe(5);
    expect(courseAlignment.role).toBe("synthesis");
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

  it("should require all five Week 5 problems, since it is their synthesis", () => {
    const relations = (JSON.parse(read("metadata.json")) as {
      relations: Array<{ type: string; source: string; target: string }>;
    }).relations;
    const required = relations
      .filter((relation) => relation.type === "requires" && relation.target.startsWith("problem."))
      .map((relation) => relation.target)
      .sort();
    expect(required).toEqual([
      "problem.ac26-w5-cmux-blind-rotation",
      "problem.ac26-w5-encoding-noise",
      "problem.ac26-w5-extract-key-switch",
      "problem.ac26-w5-lwe-rlwe",
      "problem.ac26-w5-rgsw-external",
    ]);
  });
});
