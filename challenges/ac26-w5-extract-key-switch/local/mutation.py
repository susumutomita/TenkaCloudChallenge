"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Two families here. The first is arithmetic that is wrong at one index and right at another
— a mask slot wraps only when its secret index is above the extracted one, so at the last
coefficient nothing wraps and a sign-blind extraction looks perfect. That is why every
extraction check runs every index.

The second is wrong *consistently*: a reversed digit order in `decompose_mask` paired with
a switch that reads the entries in the same reversed order agrees with itself completely.
It only separates once the submission's sample has to work in the fixtures' switch, which
is why `check_switch` crosses them.

Nothing here is an equivalent mutant, and two candidates were dropped to keep it that way.

  * skipping a zero digit in the switch's inner loop changes nothing: subtracting zero
    copies of an entry is what the reference already does. The `if not digit: continue` is a
    speed-up, not a decision.
  * "stores the source secret in the switched ciphertext's metadata" cannot be written at
    all. Every function that produces an artifact here -- `extract_sample`, `extract_trace`,
    `key_switch`, `domain_report` -- is handed no secret, at either end. `phase_coefficient`
    is the only one that gets a key, and it returns a single integer. The leak this problem
    warns about is structurally impossible rather than merely tested against, which is worth
    saying plainly instead of faking a mutation that only appears to leak. The hidden suite
    still scans the returned artifacts for either secret, so a future author who threads one
    through finds out.

An unkillable entry in this list would teach that a SURVIVED line can be ignored.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_extract  # noqa: E402

REFERENCE = (ROOT / "reference" / "extract.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "reads the phase polynomial backwards",
        [
            (
                '    return rlwe_phase(params, ring_key, ciphertext)[index]',
                '    return rlwe_phase(params, ring_key, ciphertext)[params["degree"] - 1 - index]',
            )
        ],
    ),
    (
        "accepts a coefficient index outside the ring",
        [
            (
                '    if not 0 <= index < params["degree"]:\n'
                '        raise ValueError("coefficient index outside the ring")\n'
                "    return rlwe_phase",
                "    return rlwe_phase",
            )
        ],
    ),
    (
        "extracts correctly only at the last coefficient, where nothing wraps",
        [
            (
                "        (a[index - j] if j <= index else -a[index - j + degree]) % modulus",
                "        (a[index - j] if j <= index else a[index - j + degree]) % modulus",
            )
        ],
    ),
    (
        "reverses the extracted mask",
        [
            (
                "    mask = tuple(\n"
                "        (a[index - j] if j <= index else -a[index - j + degree]) % modulus\n"
                "        for j in range(degree)\n"
                "    )",
                "    mask = tuple(\n"
                "        (a[index - j] if j <= index else -a[index - j + degree]) % modulus\n"
                "        for j in reversed(range(degree))\n"
                "    )",
            )
        ],
    ),
    (
        "wraps at the wrong side of the index, so the boundary is off by one",
        [
            (
                "        (a[index - j] if j <= index else -a[index - j + degree]) % modulus",
                "        (a[index - j] if j < index else -a[index - j + degree]) % modulus",
            )
        ],
    ),
    (
        "takes the body one coefficient along",
        [
            (
                '    return {"mask": mask, "body": _padded(params, ciphertext["b"])[index] % modulus}',
                '    return {"mask": mask, "body": _padded(params, ciphertext["b"])[(index + 1) % degree] % modulus}',
            )
        ],
    ),
    (
        "takes the body from the mask half of the ciphertext",
        [
            (
                '    return {"mask": mask, "body": _padded(params, ciphertext["b"])[index] % modulus}',
                '    return {"mask": mask, "body": _padded(params, ciphertext["a"])[index] % modulus}',
            )
        ],
    ),
    (
        "hardcodes a ring degree of four instead of reading the parameters",
        [('    degree, modulus = params["degree"], params["modulus"]\n    a = _padded', "    degree, modulus = 4, params[\"modulus\"]\n    a = _padded")],
    ),
    (
        "accepts an extraction index outside the ring",
        [
            (
                '    if not 0 <= index < params["degree"]:\n'
                '        raise ValueError("coefficient index outside the ring")\n'
                '    degree, modulus = params["degree"], params["modulus"]',
                '    degree, modulus = params["degree"], params["modulus"]',
            )
        ],
    ),
    (
        "labels every trace record as unwrapped",
        [("        wrapped = j > index\n        source", "        wrapped = False\n        source")],
    ),
    (
        "reports the trace's sign without applying it to the value",
        [
            (
                '                "value": (-a[source] if wrapped else a[source]) % modulus,',
                '                "value": a[source] % modulus,',
            )
        ],
    ),
    (
        "reports the source index without the wrap",
        [
            (
                "        source = index - j + degree if wrapped else index - j",
                "        source = index - j",
            )
        ],
    ),
    (
        "decomposes least-significant first",
        [
            (
                "    return tuple(decompose(params, value) for value in mask)",
                "    return tuple(tuple(reversed(decompose(params, value))) for value in mask)",
            )
        ],
    ),
    (
        "groups the digits by level instead of by coefficient",
        [
            (
                "    return tuple(decompose(params, value) for value in mask)",
                "    rows = [decompose(params, value) for value in mask]\n"
                "    return tuple(zip(*rows))",
            )
        ],
    ),
    (
        "drops the top level of every decomposition",
        [
            (
                "    return tuple(decompose(params, value) for value in mask)",
                "    return tuple(decompose(params, value)[1:] for value in mask)",
            )
        ],
    ),
    (
        "adds the switching-key entries instead of subtracting them",
        [
            (
                "                accumulator[i] -= digit * entry[\"mask\"][i]\n"
                "            body -= digit * entry[\"body\"]",
                "                accumulator[i] += digit * entry[\"mask\"][i]\n"
                "            body += digit * entry[\"body\"]",
            )
        ],
    ),
    (
        "subtracts the mask but not the body",
        [("            body -= digit * entry[\"body\"]", "            body -= 0")],
    ),
    (
        "reads the switching-key entries in reverse level order",
        [
            (
                '            entry = switching_key["entries"][j][level]',
                '            entry = switching_key["entries"][j][params["levels"] - 1 - level]',
            )
        ],
    ),
    (
        "pairs each mask coefficient with the wrong key row",
        [
            (
                '            entry = switching_key["entries"][j][level]',
                '            entry = switching_key["entries"][len(sample["mask"]) - 1 - j][level]',
            )
        ],
    ),
    (
        "leaves the result unreduced, so it is not a ciphertext modulo q",
        [
            (
                '        "mask": tuple(value % modulus for value in accumulator),\n'
                '        "body": body % modulus,',
                '        "mask": tuple(accumulator),\n'
                '        "body": body,',
            )
        ],
    ),
    (
        "starts the accumulator at the source mask rather than at zero",
        [
            (
                '    accumulator = [0] * switching_key["targetDimension"]',
                '    accumulator = [sample["mask"][i % len(sample["mask"])]\n'
                '                   for i in range(switching_key["targetDimension"])]',
            )
        ],
    ),
    (
        "hardcodes the source dimension instead of reading the sample",
        [
            (
                '    if switching_key["sourceDimension"] != len(sample["mask"]):',
                "    if switching_key[\"sourceDimension\"] != 4:",
            )
        ],
    ),
    (
        "applies a switching key built for a different source key",
        [
            (
                '    if sample.get("keyId") is not None and sample["keyId"] != switching_key["sourceKeyId"]:\n'
                '        raise ValueError("the switching key is for a different source key")',
                "    return",
            )
        ],
    ),
    (
        "reports the target key as the source, confusing the two domains",
        [
            (
                '        "sourceKeyId": switching_key["sourceKeyId"],',
                '        "sourceKeyId": switching_key["targetKeyId"],',
            )
        ],
    ),
    (
        "reports the ring degree as the target dimension",
        [
            (
                '        "targetDimension": switching_key["targetDimension"],',
                '        "targetDimension": params["degree"],',
            )
        ],
    ),
    (
        "calls every switching key compatible",
        [('        "compatible": _compatible(params, sample, switching_key),', '        "compatible": True,')],
    ),
    (
        "reports the switch as free of noise",
        [
            (
                '        "noiseAdded": len(sample["mask"]) * params["levels"] * (params["base"] - 1),',
                '        "noiseAdded": 0,',
            )
        ],
    ),
    (
        "reports the source dimension the key claims rather than the one the sample has",
        [
            (
                '        "sourceDimension": len(sample["mask"]),',
                '        "sourceDimension": switching_key["sourceDimension"],',
            )
        ],
    ),
    (
        "drops the target key id from the switched ciphertext, so it names no domain",
        [
            (
                '        "keyId": switching_key["targetKeyId"],\n    }',
                '        "keyId": None,\n    }',
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    module.__dict__["__file__"] = str(ROOT / "reference" / "extract.py")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_extract.run(_load(REFERENCE), SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass the hidden tests: {baseline}")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors = 0
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
            failures = check_extract.run(_load(mutated), SEED)
        except Exception as error:  # noqa: BLE001 - a mutation that crashes is caught
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    if survivors:
        print(f"\n{survivors} mutation(s) survived. The hidden tests have a hole.")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
