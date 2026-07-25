"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

A capstone fails differently from a mechanism problem, and the list below is shaped around
that.

**21 of the 37 mutations below produce a perfect truth table.** Every unary function, both
messages, all four NAND rows, at every parameter set in `VIABLE` -- and each one is still a
broken pipeline. That figure is measured rather than asserted: `main` runs every mutant
through `_truth_table_only` and fails if the count moves, because four documents cite it.
It is the single most useful thing this file has to say, because "I ran it and the answer
was right" is what checking usually means.

A 22nd is blind on most seeds and caught on this one: the dropped `q/8` offset. Its two
affected rows sit exactly on the decision boundary, so whether a truth table catches it
depends on which way the noise fell. That it moves with the seed **is** the lesson, so it
is left out of the fixed count rather than papered over.

They fall into three groups.

*Right numbers, wrong label.* Extraction that keeps the input's `keyId`, or reports the
input's dimension instead of the ring's, or calls the result an RLWE ciphertext. The
pipeline still works end to end because the switching key happens to be the matching one; it
breaks the moment anything in a circuit reads that label to decide what may be combined with
what. This is the class the artifact envelope exists for.

*Right answer, wrong account of it.* A trace whose noise bounds are all zero, an accumulator
row claiming to carry the message, an output bound that grows with the input's -- the
pipeline is fine and the story told about it is false. A learner who believes the story has
learned the wrong thing about refresh.

*Right answer by luck.* Extracting coefficient 1 instead of 0 works because the lookup table
is constant across each half of the ring, so the neighbouring coefficient almost always
holds the same value. Truncating instead of rounding works because the correctness budget
absorbs it at these parameters. Dropping the `q/8` offset works most of the time: it puts
`(0,1)` and `(1,0)` exactly on the decision boundary, so they are settled by whichever way
the noise fell -- over 40 seeds, 12 of the 80 attempts at those two rows came out wrong and
the other two rows never did. Failing intermittently is worse than failing.

Two candidates were dropped rather than faked, and both deserve saying plainly.

  * "participant code decrypts the input and re-encrypts the answer" cannot be written. No
    function in `reference/pipeline.py` is handed a secret -- not the ring secret, not the
    LWE secret, at either end. The shortcut this problem warns about is structurally absent
    rather than merely tested against. The hidden suite still scans every returned artifact
    for either secret, so a future author who threads one through finds out.
  * "the output plaintext is stored in the artifact's metadata" is the same impossibility
    seen from the other side: no stage knows the plaintext. `bootstrap` evaluates `f` on a
    ciphertext and never learns `m` or `f(m)`.

An unkillable entry in this list would teach that a SURVIVED line can be ignored.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_pipeline  # noqa: E402

REFERENCE = (ROOT / "reference" / "pipeline.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    # --- 1. The lookup table -------------------------------------------------
    (
        "writes f(0) in the upper half, so the wrap negates it",
        [
            (
                "        encode(params, table[1]) if k < degree // 2 else encode(params, 1 - table[0])",
                "        encode(params, table[1]) if k < degree // 2 else encode(params, table[0])",
            )
        ],
    ),
    (
        "puts the two halves of the lookup table the wrong way round",
        [
            (
                "        encode(params, table[1]) if k < degree // 2 else encode(params, 1 - table[0])",
                "        encode(params, 1 - table[0]) if k < degree // 2 else encode(params, table[1])",
            )
        ],
    ),
    (
        "moves the table's boundary one coefficient past the half",
        [("        encode(params, table[1]) if k < degree // 2", "        encode(params, table[1]) if k <= degree // 2")],
    ),
    (
        "gives the accumulator a mask, so it is not a trivial ciphertext",
        [('        "a": tuple([0] * degree),', '        "a": tuple(range(degree)),')],
    ),
    (
        "claims the accumulator carries noise it cannot have",
        [
            (
                '        "parameterSetId": params["parameterSetId"],\n        "noiseBound": 0,\n    }',
                '        "parameterSetId": params["parameterSetId"],\n        "noiseBound": 1,\n    }',
            )
        ],
    ),
    # --- 2. The rotation domain ----------------------------------------------
    (
        "truncates instead of rounding when rescaling to the rotation domain",
        [
            (
                "        return ((value % q) * modulus + q // 2) // q % modulus",
                "        return ((value % q) * modulus) // q % modulus",
            )
        ],
    ),
    (
        "rescales by N rather than 2N, so half the ring is unreachable",
        [
            (
                '    modulus, q = 2 * params["degree"], params["modulus"]',
                '    modulus, q = params["degree"], params["modulus"]',
            )
        ],
    ),
    (
        "reports the domain switch as free of rounding error",
        [
            (
                '        "noiseBound": (params["dimension"] + 1) // 2,',
                '        "noiseBound": 0,',
            )
        ],
    ),
    # --- 3. Blind rotation ---------------------------------------------------
    (
        "rotates the accumulator by +phase instead of -phase",
        [
            (
                '    current = rotate_ciphertext(params, accumulator, -rotated["body"])',
                '    current = rotate_ciphertext(params, accumulator, rotated["body"])',
            )
        ],
    ),
    (
        "reverses the CMUX arguments, so every secret bit is read inverted",
        [
            (
                "            params, bootstrap_key[index], current, rotate_ciphertext(params, current, mask)",
                "            params, bootstrap_key[index], rotate_ciphertext(params, current, mask), current",
            )
        ],
    ),
    (
        "skips the last mask coefficient of the blind rotation",
        [
            (
                '    for index, mask in enumerate(rotated["mask"]):',
                '    for index, mask in enumerate(rotated["mask"][:-1]):',
            )
        ],
    ),
    (
        "ignores the mask entirely, so the rotation does not depend on the encrypted bit",
        [
            (
                "        current = cmux(\n"
                "            params, bootstrap_key[index], current, rotate_ciphertext(params, current, mask)\n"
                "        )",
                "        current = cmux(params, bootstrap_key[index], current, current)",
            )
        ],
    ),
    (
        "hardcodes a ring degree of sixteen instead of reading the parameters",
        [
            (
                '        "dimension": params["degree"],\n        "modulus": params["modulus"],\n'
                '        "parameterSetId": params["parameterSetId"],\n'
                '        "noiseBound": blind_rotation_noise(params),',
                '        "dimension": 16,\n        "modulus": params["modulus"],\n'
                '        "parameterSetId": params["parameterSetId"],\n'
                '        "noiseBound": blind_rotation_noise(params),',
            )
        ],
    ),
    # --- 4. Extraction -------------------------------------------------------
    (
        "extracts a hardcoded coefficient that is not the one the rotation aimed at",
        [("    sample = extract_sample(params, rotated, 0)", "    sample = extract_sample(params, rotated, 1)")],
    ),
    (
        "keeps the input's key id on the extracted sample, so it names the wrong domain",
        [
            (
                '        "kind": "lwe",\n        "keyId": rotated["keyId"],\n'
                '        "dimension": params["degree"],',
                '        "kind": "lwe",\n        "keyId": switch_key_id_of(rotated),\n'
                '        "dimension": params["degree"],',
            ),
            (
                "def extract(params: dict, rotated: dict) -> dict:",
                "def switch_key_id_of(rotated):\n"
                "    return \"a-different-key\"\n\n\n"
                "def extract(params: dict, rotated: dict) -> dict:",
            ),
        ],
    ),
    (
        "reports the extracted sample at the input's dimension rather than the ring's",
        [
            (
                '        "keyId": rotated["keyId"],\n        "dimension": params["degree"],',
                '        "keyId": rotated["keyId"],\n        "dimension": params["dimension"],',
            )
        ],
    ),
    (
        "calls the extracted sample a ring ciphertext, which it no longer is",
        [
            (
                '    return {\n        "mask": sample["mask"],\n        "body": sample["body"],\n        "kind": "lwe",',
                '    return {\n        "mask": sample["mask"],\n        "body": sample["body"],\n        "kind": "rlwe",',
            )
        ],
    ),
    # --- 5. Key switching ----------------------------------------------------
    (
        "applies a switching key built for a different source key",
        [("    _require_compatible(params, switching_key, sample)\n    switched", "    switched")],
    ),
    (
        "leaves the switched sample under the source key id",
        [
            (
                '        "keyId": switching_key["targetKeyId"],\n'
                '        "dimension": switching_key["targetDimension"],',
                '        "keyId": switching_key["sourceKeyId"],\n'
                '        "dimension": switching_key["targetDimension"],',
            )
        ],
    ),
    (
        "forgets that the key switch adds noise of its own",
        [
            (
                '        "noiseBound": sample["noiseBound"] + key_switch_noise(params),',
                '        "noiseBound": sample["noiseBound"],',
            )
        ],
    ),
    # --- 6. The pipeline -----------------------------------------------------
    (
        "extracts before rotating, so the lookup never happens",
        [
            (
                "    rotated = blind_rotate(params, bootstrap_key, to_rotation_domain(params, sample), accumulator)\n"
                "    return switch(params, switching_key, extract(params, rotated))",
                "    return switch(params, switching_key, extract(params, accumulator))",
            )
        ],
    ),
    (
        "skips the domain switch and rotates by a Z_q phase",
        [
            (
                "    rotated = blind_rotate(params, bootstrap_key, to_rotation_domain(params, sample), accumulator)",
                "    rotated = blind_rotate(params, bootstrap_key, {**sample, \"noiseBound\": 0}, accumulator)",
            )
        ],
    ),
    # --- 7. The trace and the refresh ----------------------------------------
    (
        "zeroes every noise bound in the trace rather than reporting the pipeline's",
        [('             correctness_bound(params), True, "m", "whole", lwe_digest(sample)),', '             0, True, "m", "whole", lwe_digest(sample)),')],
    ),
    (
        "claims the accumulator carries the message, when it carries the function",
        [
            (
                '             params["modulus"], 0, False, None, None, rlwe_digest(params, accumulator)),',
                '             params["modulus"], 0, True, "m", "whole", rlwe_digest(params, accumulator)),',
            )
        ],
    ),
    (
        "says f(m) is spread through the rotated polynomial rather than at one coefficient",
        [
            (
                '             params["modulus"], blind_rotation_noise(params), True, "f(m)", "coefficient-0",',
                '             params["modulus"], blind_rotation_noise(params), True, "f(m)", "whole",',
            )
        ],
    ),
    (
        "fingerprints the final answer at every stage, so the trace records nothing",
        [
            (
                "             rlwe_digest(params, rotated)),",
                "             lwe_digest(switched)),",
            )
        ],
    ),
    (
        "adds the input's noise to the output bound, so nothing was refreshed",
        [
            (
                "    return blind_rotation_noise(params) + key_switch_noise(params)",
                "    return blind_rotation_noise(params) + key_switch_noise(params) + params[\"delta\"] // 64",
            ),
            (
                '        "outputNoiseBound": output_noise_bound(params),',
                '        "outputNoiseBound": output_noise_bound(params) + abs(input_noise),',
            ),
        ],
    ),
    (
        "spends none of the correctness budget on the domain switch's rounding",
        [
            (
                '    spare = params["degree"] // 4 - (params["dimension"] + 1) / 2',
                '    spare = params["degree"] // 4',
            )
        ],
    ),
    (
        "calls every input within the correctness contract",
        [
            (
                '        "withinContract": abs(input_noise) <= correctness_bound(params),',
                '        "withinContract": True,',
            )
        ],
    ),
    # --- 8. The NAND combination ---------------------------------------------
    (
        "drops the q/8 offset, so two truth-table rows land on the decision boundary",
        [
            (
                '        "body": (params["delta"] - left["body"] - right["body"]) % modulus,',
                '        "body": (-left["body"] - right["body"]) % modulus,',
            )
        ],
    ),
    (
        "adds the two bits instead of subtracting them",
        [
            (
                '        "mask": tuple((-x - y) % modulus for x, y in zip(left["mask"], right["mask"])),\n'
                '        "body": (params["delta"] - left["body"] - right["body"]) % modulus,',
                '        "mask": tuple((x + y) % modulus for x, y in zip(left["mask"], right["mask"])),\n'
                '        "body": (params["delta"] + left["body"] + right["body"]) % modulus,',
            )
        ],
    ),
    (
        "combines only one of the two bits",
        [
            (
                '        "mask": tuple((-x - y) % modulus for x, y in zip(left["mask"], right["mask"])),\n'
                '        "body": (params["delta"] - left["body"] - right["body"]) % modulus,',
                '        "mask": tuple((-x) % modulus for x in left["mask"]),\n'
                '        "body": (params["delta"] - left["body"]) % modulus,',
            )
        ],
    ),
    (
        "uses the wrong offset, shifting the whole truth table by one row",
        [
            (
                '        "body": (params["delta"] - left["body"] - right["body"]) % modulus,',
                '        "body": (3 * params["delta"] - left["body"] - right["body"]) % modulus,',
            )
        ],
    ),
    (
        "counts only one input's noise into the combination's bound",
        [
            (
                '        "noiseBound": left.get("noiseBound", 0) + right.get("noiseBound", 0),',
                '        "noiseBound": left.get("noiseBound", 0),',
            )
        ],
    ),
    (
        "combines two bits that are not under the same key",
        [
            (
                '    if left.get("keyId") != right.get("keyId"):\n'
                '        raise ValueError("the two bits are not under the same key")',
                "    pass",
            )
        ],
    ),
    # --- 9. The gate ---------------------------------------------------------
    (
        "evaluates NAND with a lookup table instead of the identity, inverting it",
        [
            (
                '        params, bootstrap_key, switching_key, nand_combine(params, left, right), {0: 0, 1: 1}',
                '        params, bootstrap_key, switching_key, nand_combine(params, left, right), {0: 1, 1: 0}',
            )
        ],
    ),
    (
        "returns a constant 1, which is three of the four truth-table rows",
        [
            (
                "    return bootstrap(\n"
                '        params, bootstrap_key, switching_key, nand_combine(params, left, right), {0: 0, 1: 1}\n'
                "    )",
                "    return bootstrap(\n"
                "        params, bootstrap_key, switching_key,\n"
                '        {**left, "body": (left["body"] * 0 + params["delta"]) % params["modulus"],\n'
                '         "mask": tuple(0 for _ in left["mask"])},\n'
                "        {0: 0, 1: 1},\n"
                "    )",
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = str(ROOT / "reference" / "pipeline.py")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def _truth_table_only(module, seed: str = "truth-table-seed") -> bool:
    """The weakest test anyone would actually write, run at full strength.

    Every unary function, both messages, all four NAND rows, at every parameter set in
    `VIABLE` -- and nothing checked except the decrypted bit. This is what "I ran it and it
    worked" means when someone has been thorough about it.

    Counting how many mutations survive it is the measurement the whole checkpoint layout
    rests on, so it is computed here rather than quoted from a comment. If a change to the
    reference moves the number, the READMEs and the metadata that cite it are wrong.
    """
    from fixtures.generate import (  # noqa: PLC0415 - only the author tool needs these
        UNARY,
        VIABLE,
        bootstrap_key,
        key_id,
        lwe_decrypt,
        lwe_encrypt,
        lwe_secret,
        parameter_set_id,
        ring_secret,
        switching_key,
    )

    for base, levels, degree, dimension in VIABLE:
        modulus = base**levels
        par = {
            "base": base, "levels": levels, "degree": degree, "dimension": dimension,
            "modulus": modulus, "plaintext_modulus": 2, "delta": modulus // 8,
            "parameterSetId": parameter_set_id(base, levels, degree, dimension),
            "encodingId": "balanced-eighth",
        }
        ring_key, lwe_key = ring_secret(seed, par), lwe_secret(seed, par)
        key = bootstrap_key(seed, par, ring_key, lwe_key)
        source_id, target_id = key_id(seed, "ring"), key_id(seed, "lwe")
        switch = switching_key(seed, par, ring_key, lwe_key, source_id, target_id, "ks")

        def encrypt(bit: int, label: str) -> dict:
            return {
                **lwe_encrypt(seed, par, lwe_key, bit, label),
                "keyId": target_id,
                "dimension": par["dimension"],
            }

        for name, function in UNARY.items():
            table = {0: function(0), 1: function(1)}
            for message in (0, 1):
                out = module.bootstrap(par, key, switch, encrypt(message, f"{name}{message}"), table)
                if lwe_decrypt(par, lwe_key, out) != function(message):
                    return False
        for left_bit in (0, 1):
            for right_bit in (0, 1):
                gate = module.homomorphic_nand(
                    par, key, switch,
                    encrypt(left_bit, f"n{left_bit}{right_bit}l"),
                    encrypt(right_bit, f"n{left_bit}{right_bit}r"),
                )
                if lwe_decrypt(par, lwe_key, gate) != 1 - (left_bit & right_bit):
                    return False
    return True


#: Measured at the fixed seed above, then written into README.md, README.ja.md and
#: metadata.json. Asserted in `main` so those documents cannot drift away from the reference.
#: The dropped-offset mutation is deliberately not in this count -- it is blind on most seeds
#: and caught on this one, which is the intermittency the problem is teaching.
TRUTH_TABLE_BLIND = 21


def main() -> int:
    baseline = check_pipeline.run(_load(REFERENCE), SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors = 0
    blind = 0
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (the mutation no longer applies to the reference)")
            survivors += 1
            continue
        mutated = REFERENCE
        for needle, replacement in substitutions:
            mutated = mutated.replace(needle, replacement)
        try:
            mutant = _load(mutated)
            failures = check_pipeline.run(mutant, SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            mutant, failures = None, [f"raised {type(error).__name__}"]
        try:
            invisible = mutant is not None and _truth_table_only(mutant)
        except Exception:  # noqa: BLE001 - a mutant that crashes is visible by definition
            invisible = False
        blind += int(invisible)
        if failures:
            print(f"KILLED{' [truth-table-blind]' if invisible else ''} {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed.")
    print(f"TRUTH-TABLE-BLIND {blind} of {len(MUTATIONS)}")
    if blind != TRUTH_TABLE_BLIND:
        print(
            f"\nExpected {TRUTH_TABLE_BLIND} truth-table-blind mutations, measured {blind}. "
            "README.md, README.ja.md and metadata.json all cite that number; update them "
            "together with TRUTH_TABLE_BLIND."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
