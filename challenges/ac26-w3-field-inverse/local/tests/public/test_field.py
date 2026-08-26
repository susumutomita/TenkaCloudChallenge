"""Public tests. They show the shape of an answer; they do not prove one correct.

They use one prime, a handful of small positive values, and never touch the composite
case. An implementation that normalizes only sometimes, or that computes inverses by
Fermat's little theorem, passes this file completely.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import field as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's moduli -- what `show.py` prints.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module implements `egcd` under the exact name the starter's own stub
    asks the learner to write, and `egcd_rows` supplies the trace its `egcd_trace` stub
    asks for, so it does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile). This deployment's own verifier is the only source for the public
    half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w3-field-inverse.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def check_elements_are_canonical() -> str:
    p = PUBLIC["primeModulus"]
    f = submission.Field(p)
    for raw in (0, 1, p, p + 1, -1):
        element = f.element(raw)
        if not 0 <= element.value < p:
            return f"element({raw}) is {element.value}, which is not in [0, {p})"
    return ""


def check_arithmetic_on_small_values() -> str:
    p = PUBLIC["primeModulus"]
    f = submission.Field(p)
    a, b = f.element(6), f.element(7)
    if (a + b).value != 13 % p:
        return "6 + 7 is wrong"
    if (a * b).value != 42 % p:
        return "6 * 7 is wrong"
    return ""


def check_inverse_of_one_element() -> str:
    p = PUBLIC["primeModulus"]
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
