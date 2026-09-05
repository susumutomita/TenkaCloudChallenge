"""Author-side check: break the reference on purpose and confirm the hidden suite notices.

Every mutant below is a line a learner actually mistypes: the wire share built by adding
back the randomness instead of subtracting, the coefficients swapped in a linear form,
crossmul's "correct" side added instead of multiplied, the Beaver open with the sign
flipped (subtract replaced by add -- the note's own line 10 mistake), the constant d*e
correction forgotten in the C shares, the a*b term dropped from the textbook identity,
the sign flipped in the no-link derivation, and reconstruct's tuple returned in the
wrong order. Each must be KILLED by `tests/hidden/check_co_snark_drill.py` -- most are
caught twice over, once by the seed-derived checks and once by `check_crafted`'s
hand-verified example, which does not depend on any deployment's draw.

The verifier-level mutations at the end cannot be expressed as a broken submission: they
check that the value grader itself refuses the near-misses a learner pastes -- the
trivial (already-public) half of a share, a coefficient vector mistaken for an answer, a
sum mistaken for a product, one Beaver factor mistaken for the opened value, another
line's value, a truncated tuple, a boolean, and another deployment's answer.
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fixtures.generate import GRADED, setting  # noqa: E402
from tests.hidden import check_co_snark_drill  # noqa: E402
from verifier.expected import expected_for  # noqa: E402

REFERENCE = (ROOT / "reference" / "co_snark_drill.py").read_text(encoding="utf-8")
#: Chosen so that every source-level mutant below produces a different value than the
#: reference on at least one checked line (verified when the suite runs -- a surviving
#: mutant fails the build).
SEED = "mutation-seed-1"

MUTATIONS: dict[str, tuple[str, str]] = {
    "wire shares built by adding the randomness back, not subtracting it": (
        "    return [r0 % p, (w[0] - r0) % p], [r1 % p, (w[1] - r1) % p]",
        "    return [r0 % p, (w[0] + r0) % p], [r1 % p, (w[1] + r1) % p]",
    ),
    "shares graded on the trivial first entry instead of the second": (
        "    return (w0[1], w1[1])",
        "    return (w0[0], w1[0])",
    ),
    "reconstruct returned in the wrong order": (
        "    return (sum(w0) % p, sum(w1) % p)",
        "    return (sum(w1) % p, sum(w0) % p)",
    ),
    "A's linear form with the coefficients swapped": (
        "    return [(ca[0] * x + ca[1] * y) % p for x, y in zip(w0, w1)]",
        "    return [(ca[1] * x + ca[0] * y) % p for x, y in zip(w0, w1)]",
    ),
    "A's direct side using the wrong coefficient order": (
        "    return (sum(a_sh) % p, (ca[0] * w[0] + ca[1] * w[1]) % p)",
        "    return (sum(a_sh) % p, (ca[1] * w[0] + ca[0] * w[1]) % p)",
    ),
    "B's linear form with the coefficients swapped": (
        "    b_sh = [(cb[0] * x + cb[1] * y) % p for x, y in zip(w0, w1)]",
        "    b_sh = [(cb[1] * x + cb[0] * y) % p for x, y in zip(w0, w1)]",
    ),
    "crossmul's correct side added instead of multiplied": (
        "    return (naive, (A * B) % p)",
        "    return (naive, (A + B) % p)",
    ),
    "the triple check multiplying instead of confirming with a sum": (
        "    return (sum(a_sh) % p, sum(b_sh) % p, sum(c_sh) % p, (a * b) % p)",
        "    return (sum(a_sh) % p, sum(b_sh) % p, sum(c_sh) % p, (a + b) % p)",
    ),
    "the Beaver open with the sign flipped (add instead of subtract)": (
        "    d = (A - sum(a_sh)) % p\n    e = (B - sum(b_sh)) % p",
        "    d = (A + sum(a_sh)) % p\n    e = (B + sum(b_sh)) % p",
    ),
    "the constant d*e correction forgotten in C's shares": (
        "    z[0] = (z[0] + d * e) % p",
        "    z[0] = z[0] % p",
    ),
    "the a*b term dropped from the textbook identity": (
        "    return (d * e + d * b + e * a + a * b) % p",
        "    return (d * e + d * b + e * a) % p",
    ),
    "the sign flipped in the no-link derivation": (
        "    return [(cand, (cand - d) % p) for cand in (A, (A + p // 3) % p, (A + 2 * (p // 3)) % p)]",
        "    return [(cand, (cand + d) % p) for cand in (A, (A + p // 3) % p, (A + 2 * (p // 3)) % p)]",
    ),
}


def _canon(value):
    return tuple(value) if isinstance(value, (list, tuple)) else value


def _different(expected, *candidates):
    """The first near-miss that is not accidentally the right answer for this seed."""
    for candidate in candidates:
        if _canon(candidate) != _canon(expected):
            return candidate
    raise RuntimeError("every near-miss equals the expected value; pick another seed")


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("co_snark_drill_mutant")
    exec(compile(source, "co_snark_drill_mutant", "exec"), module.__dict__)  # noqa: S102 - author tooling
    return module


def main() -> int:
    survivors: list[str] = []

    reference = _load(REFERENCE)
    failures = check_co_snark_drill.run(reference, SEED)
    if failures:
        print("FAIL reference implementation fails the hidden tests:", failures)
        return 1
    print("PASS reference implementation passes the hidden tests")

    for name, (old, new) in MUTATIONS.items():
        if old not in REFERENCE:
            print(f"BROKEN mutation target not found: {name}")
            return 1
        mutant = _load(REFERENCE.replace(old, new, 1))
        try:
            failures = check_co_snark_drill.run(mutant, SEED)
        except Exception as error:  # noqa: BLE001 - a crashing mutant is killed
            failures = [f"raised {type(error).__name__}"]
        if failures:
            print(f"KILLED   {name}")
        else:
            print(f"SURVIVED {name}")
            survivors.append(name)

    # Verifier-level: the value grader must refuse what a learner would paste by mistake.
    os.environ["FLAG_SEED"] = SEED
    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path and env

    pub = setting(SEED)["public"]
    exp = expected_for(SEED)
    other = expected_for("another-deployment")
    near_misses = {
        "shares accepts the trivial, already-public first entries": (
            "shares",
            _different(exp["shares"], [pub["r0"], pub["r1"]], [0, 0]),
        ),
        "ashares accepts the coefficient vector itself": (
            "ashares",
            _different(exp["ashares"], list(pub["ca"]), [0, 0]),
        ),
        "aopen accepts the coefficient vector instead of A": (
            "aopen",
            _different(exp["aopen"], list(pub["ca"]), [0, 0]),
        ),
        "bshares accepts the coefficient vector extended with a zero": (
            "bshares",
            _different(exp["bshares"], [pub["cb"][0], pub["cb"][1], 0], [0, 0, 0]),
        ),
        "crossmul accepts the correct product on both sides": (
            "crossmul",
            _different(exp["crossmul"], [exp["crossmul"][1], exp["crossmul"][1]], [0, 0]),
        ),
        "beaveropen accepts the Beaver factors instead of the opened d, e": (
            "beaveropen",
            _different(exp["beaveropen"], [pub["a"], pub["b"]], [0, 0]),
        ),
        "cshares accepts the triple's own c share": (
            "cshares",
            _different(exp["cshares"], [pub["rc"], (pub["a"] * pub["b"] - pub["rc"]) % pub["p"]], [0, 0]),
        ),
        "csum accepts A instead of C": ("csum", _different(exp["csum"], exp["aopen"][0], -1)),
        "csum accepts a truncated cshares": ("csum", _different(exp["csum"], exp["cshares"][0], -1)),
        "csum accepts a boolean": ("csum", True),
        "aopen accepts one value short": ("aopen", [exp["aopen"][0]]),
        "another deployment's shares": ("shares", _different(exp["shares"], other["shares"], [-1, -1])),
    }
    for name, (line, value) in near_misses.items():
        if evaluate(line, value):
            print(f"SURVIVED verifier: {name}")
            survivors.append(name)
        else:
            print(f"KILLED   verifier: {name}")
    for line in GRADED:
        value = exp[line]
        if not evaluate(line, list(value) if isinstance(value, tuple) else value):
            print(f"SURVIVED verifier: rejects the correct value for {line}")
            survivors.append(f"correct {line}")

    if survivors:
        print(f"{len(survivors)} mutation(s) survived.")
        return 1
    print(f"All {len(MUTATIONS) + len(near_misses)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
