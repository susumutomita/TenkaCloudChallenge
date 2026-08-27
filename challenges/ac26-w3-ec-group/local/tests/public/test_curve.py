"""Public tests. They show the shape of an answer; they do not prove one correct.

They add two distinct points, and they check that the identity behaves. They never
double a point, never touch a point with y = 0, never multiply by a scalar, and never
look at secp256k1. An implementation with only the generic slope formula passes this
file and fails four of the eight checkpoints.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import curve as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _load_public_evidence() -> dict:
    """This deployment's curve and its affine points -- what `show.py` prints, and what
    this file has always handed to `Curve(p, a, b)`.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module derives the curve, the sample points and the scalars every
    checkpoint is graded against, and it shipped in the same image as
    `tests/hidden/check_curve.py`, whose `_ReferenceCurve` is a complete group law --
    so neither ships in the `participant` Docker stage any more (see ../../Dockerfile).
    This deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
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
    # scripts/ac26-w3-ec-group.test.ts) and the verifier/author Docker stages, and never
    # inside a built `participant` image -- so this branch does not reopen the leak
    # above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _load_public_evidence()


def _curve():
    params = PUBLIC["params"]
    every = [tuple(coords) for coords in PUBLIC["points"]]
    return submission.Curve(params["p"], params["a"], params["b"]), every


def check_points_are_recognized() -> str:
    curve_obj, every = _curve()
    for coords in every[:4]:
        if not curve_obj.contains(submission.Point(curve_obj, *coords)):
            return f"{coords} is on the curve but was not recognized"
    return ""


def check_identity_behaves() -> str:
    curve_obj, every = _curve()
    identity = curve_obj.infinity()
    if not identity.is_infinity:
        return "the identity does not report itself as the identity"
    point = curve_obj.point(*every[0])
    if (identity + point) != point:
        return "adding the identity changed the point"
    return ""


def check_two_points_add() -> str:
    curve_obj, every = _curve()
    left, right = curve_obj.point(*every[0]), curve_obj.point(*every[1])
    total = left + right
    if not curve_obj.contains(total):
        return "the sum of two points is not on the curve"
    return ""


CHECKS = (
    ("points-are-recognized", check_points_are_recognized),
    ("identity-behaves", check_identity_behaves),
    ("two-points-add", check_two_points_add),
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
        print("\nNothing here doubled a point, used a scalar, or touched secp256k1.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
