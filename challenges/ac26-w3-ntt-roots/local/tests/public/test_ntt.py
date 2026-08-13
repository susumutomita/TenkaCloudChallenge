"""Public tests. They show the shape of an answer; they do not prove one correct.

They use one prime, a handful of small positive values, and never touch the composite
case. An implementation that normalizes only sometimes, or that computes inverses by
Fermat's little theorem, passes this file completely.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import field as submission  # noqa: E402
from fixtures.generate import prime_modulus  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_elements_are_canonical() -> str:
    p = prime_modulus(SEED)
    f = submission.Field(p)
    for raw in (0, 1, p, p + 1, -1):
        element = f.element(raw)
        if not 0 <= element.value < p:
            return f"element({raw}) is {element.value}, which is not in [0, {p})"
    return ""


def check_arithmetic_on_small_values() -> str:
    p = prime_modulus(SEED)
    f = submission.Field(p)
    a, b = f.element(6), f.element(7)
    if (a + b).value != 13 % p:
        return "6 + 7 is wrong"
    if (a * b).value != 42 % p:
        return "6 * 7 is wrong"
    return ""


def check_inverse_of_one_element() -> str:
    p = prime_modulus(SEED)
    f = submission.Field(p)
    a = f.element(6)
    if (a * a.inverse()).value != 1:
        return "an element times its inverse is not one"
    return ""


CHECKS = (
    ("elements-are-canonical", check_elements_are_canonical),
    ("arithmetic-on-small-values", check_arithmetic_on_small_values),
    ("inverse-of-one-element", check_inverse_of_one_element),
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
        print("\nNo negative value, no composite modulus, no mixed field was tried here.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
