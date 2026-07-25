"""Public tests. They show the shape of an answer; they do not prove one correct.

They normalize a sequence that is already short enough to need no folding, multiply two
polynomials whose product never reaches degree N, and round-trip one LWE and one RLWE
ciphertext with no noise at all. Every one of those is chosen to stay away from the place
the checkpoints live.

A cyclic convolution passes this file completely. So does a `normalize` whose sign rule is a
one-way threshold rather than a period, a `survives` that sums instead of taking the maximum,
and a validator that accepts anything. The one thing this file does prove is that your
functions exist and return the right kind of object.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import lattice as submission  # noqa: E402
from fixtures.generate import (  # noqa: E402
    lwe_case,
    normalize as reference_normalize,
    params,
    rlwe_case,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_normalize_reduces_a_short_sequence() -> str:
    """Nothing here folds: every index is already below N."""
    par = params(SEED)
    raw = [par["q"] + 1, -1] + [0] * (par["degree"] - 2)
    if tuple(submission.normalize(par, raw)) != reference_normalize(par, raw):
        return "a sequence that needs no folding did not reduce into [0, q)"
    return ""


def check_a_product_that_never_wraps() -> str:
    """Two low-degree polynomials, so the product stays below degree N.

    Both multiplication rules agree here. That is the point of putting it in the public set.
    """
    par = params(SEED)
    n = par["degree"]
    f = [1, 2] + [0] * (n - 2)
    g = [3, 0] + [0] * (n - 2)
    expected = reference_normalize(par, [3, 6] + [0] * (n - 2))
    if tuple(submission.ring_mul(par, f, g)) != expected:
        return "(1 + 2X)(3) is not 3 + 6X in this ring"
    return ""


def check_an_lwe_round_trip_with_no_noise() -> str:
    """Message 1, not the seed's, so a stub returning 0 cannot pass by coincidence."""
    par = params(SEED)
    case = lwe_case(par, SEED, "public", 0)
    ciphertext = submission.lwe_encrypt(par, case["secret"], 1, case["mask"], 0)
    if submission.lwe_decrypt(par, case["secret"], ciphertext) != 1:
        return "a noiseless LWE ciphertext did not decrypt to 1"
    return ""


def check_an_rlwe_round_trip_with_no_noise() -> str:
    """Likewise: at least one coefficient is non-zero, whatever the seed drew."""
    par = params(SEED)
    case = rlwe_case(par, SEED, "public", 0)
    zero = tuple(0 for _ in range(par["degree"]))
    message = tuple(1 if index == 0 else m for index, m in enumerate(case["message"]))
    ciphertext = submission.rlwe_encrypt(par, case["secret"], message, case["mask"], zero)
    if tuple(submission.rlwe_decrypt(par, case["secret"], ciphertext)) != message:
        return "a noiseless RLWE ciphertext did not decrypt to its messages"
    return ""


CHECKS = (
    ("normalize-reduces-a-short-sequence", check_normalize_reduces_a_short_sequence),
    ("a-product-that-never-wraps", check_a_product_that_never_wraps),
    ("an-lwe-round-trip-with-no-noise", check_an_lwe_round_trip_with_no_noise),
    ("an-rlwe-round-trip-with-no-noise", check_an_rlwe_round_trip_with_no_noise),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here wrapped past degree N, and the wrap is what is graded.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
