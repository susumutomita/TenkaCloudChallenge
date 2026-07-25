"""Author-side check: break the reference on purpose and confirm the hidden tests notice.

Every mutation here is off by one interval, one representative, or one parameter set --
never by a whole algorithm. Most produce a file that decodes every exact encoding point
correctly, which is the property a learner checks first and the reason it is not enough.

Nothing here is an equivalent mutant, and finding that out cost two entries.

`validate_params`' `delta >= 1` rule cannot be broken detectably: `q = p * delta` with
`q >= 1` and `p >= 2` already forces `delta >= 1`, so relaxing the bound changes no
verdict on any input. It is defence in depth and a better error message, not a load-
bearing rule, and it is not mutated here.

`encode`'s `m % p` cannot be broken detectably either: `(m % p) * D` and `m * D` are
congruent modulo `p * D` for every integer `m`, so the reduction is presentational. What
IS load-bearing is the outer `% q`, and that is mutated.

Both were verified rather than assumed -- exhaustively over the parameter ranges this
problem generates. Leaving an unkillable mutant in the list would teach that a SURVIVED
line can be ignored, so neither is here.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_encoding  # noqa: E402

REFERENCE = (ROOT / "reference" / "encoding.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "centers on the wrong side of the half-way point",
        [("    return value - q if value >= (q + 1) // 2 else value", "    return value - q if value > q // 2 else value")],
    ),
    (
        "centers into [0, q) after all, so nothing is ever negative",
        [("    return value - q if value >= (q + 1) // 2 else value", "    return value")],
    ),
    (
        "takes the absolute value of the noise",
        [("    return (c + e) % params[\"q\"]", "    return (c + abs(e)) % params[\"q\"]")],
    ),
    (
        "adds the noise without reducing into the ring",
        [("    return (c + e) % params[\"q\"]", "    return c + e")],
    ),
    (
        "floors instead of rounding to nearest",
        [
            (
                '    return ((c % params["q"]) + delta // 2) // delta % params["p"]',
                '    return (c % params["q"]) // delta % params["p"]',
            )
        ],
    ),
    (
        "rounds ties down, disagreeing with the interval it reports",
        [
            (
                '    return ((c % params["q"]) + delta // 2) // delta % params["p"]',
                '    return ((c % params["q"]) + (delta - 1) // 2) // delta % params["p"]',
            )
        ],
    ),
    (
        "forgets that the point past the last message is message 0",
        [
            (
                '    return ((c % params["q"]) + delta // 2) // delta % params["p"]',
                '    return ((c % params["q"]) + delta // 2) // delta',
            )
        ],
    ),
    (
        "hardcodes a scaling factor instead of reading the parameters",
        [('    delta = params["delta"]\n    return ((c % params["q"]) + delta // 2)', "    delta = 16\n    return ((c % params[\"q\"]) + delta // 2)")],
    ),
    (
        "reports the symmetric interval, ignoring the tie rule",
        [
            (
                "    return (-(delta // 2), delta - delta // 2 - 1)",
                "    return (-(delta // 2), delta // 2)",
            )
        ],
    ),
    (
        "reports an interval one short at the bottom",
        [
            (
                "    return (-(delta // 2), delta - delta // 2 - 1)",
                "    return (-(delta // 2) + 1, delta - delta // 2 - 1)",
            )
        ],
    ),
    (
        "names the failing message without wrapping it modulo p",
        [
            (
                "    noise = high + 1 if direction > 0 else low - 1\n"
                "    return (noise, decode(params, add_noise(params, encode(params, m), noise)))",
                "    noise = high + 1 if direction > 0 else low - 1\n"
                "    return (noise, m + 1 if direction > 0 else m - 1)",
            )
        ],
    ),
    (
        "searches from the wrong end, returning a noise that still decodes",
        [
            (
                "    noise = high + 1 if direction > 0 else low - 1",
                "    noise = high if direction > 0 else low",
            )
        ],
    ),
    (
        "accepts a q that is not p * delta",
        [
            (
                '    if not failures and q != p * delta:\n'
                '        failures.append("q must equal p * delta, or the encoding points do not tile the ring")',
                "    pass",
            )
        ],
    ),
    (
        "searches upward whichever direction it was asked for",
        [
            (
                "    noise = high + 1 if direction > 0 else low - 1",
                "    noise = high + 1",
            )
        ],
    ),
    (
        "accepts a one-message space, where decoding decides nothing",
        [
            (
                "    if not isinstance(p, int) or isinstance(p, bool) or p < 2:",
                "    if not isinstance(p, int) or isinstance(p, bool) or p < 1:",
            )
        ],
    ),
    (
        "rejects delta = 1, a usable parameter set that tolerates no noise",
        [
            (
                "    if not isinstance(delta, int) or isinstance(delta, bool) or delta < 1:",
                "    if not isinstance(delta, int) or isinstance(delta, bool) or delta < 2:",
            )
        ],
    ),
    (
        "returns the encoding point without reducing it into the ring",
        [
            (
                '    return (m % params["p"]) * params["delta"] % params["q"]',
                '    return m * params["delta"]',
            )
        ],
    ),
)


def _load(source: str):
    import types

    module = types.ModuleType("mutant")
    exec(compile(source, "<mutant>", "exec"), module.__dict__)  # noqa: S102 - author tool
    return module


def main() -> int:
    baseline = check_encoding.run(_load(REFERENCE), SEED)
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
            failures = check_encoding.run(_load(mutated), SEED)
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
