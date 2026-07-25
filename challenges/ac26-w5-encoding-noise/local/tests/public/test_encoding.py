"""Public tests. They show the shape of an answer; they do not prove one correct.

They encode, decode, and add a little noise, on one parameter set. They never test the
exact half-way point, never use a negative noise, never cross a boundary, and never look
at the message at either end of the space. Those four are where all the checkpoints live.

An implementation that floors instead of rounding to nearest passes this file entirely,
because flooring is right for every noise value that happens to be non-negative and small.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import encoding as submission  # noqa: E402
from fixtures.generate import encode as reference_encode, params  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_encode_matches_the_rule() -> str:
    par = params(SEED)
    for m in range(par["p"]):
        if submission.encode(par, m) != reference_encode(par, m):
            return f"message {m} does not encode to m * delta in the ring"
    return ""


def check_an_exact_point_decodes_to_itself() -> str:
    par = params(SEED)
    for m in range(par["p"]):
        if submission.decode(par, reference_encode(par, m)) != m:
            return f"the encoding point for {m} does not decode back to {m}"
    return ""


def check_a_little_noise_survives() -> str:
    par = params(SEED)
    for m in range(par["p"]):
        noisy = submission.add_noise(par, reference_encode(par, m), 1)
        if submission.decode(par, noisy) != m:
            return f"one unit of noise already broke message {m}"
    return ""


CHECKS = (
    ("encode-matches-the-rule", check_encode_matches_the_rule),
    ("an-exact-point-decodes-to-itself", check_an_exact_point_decodes_to_itself),
    ("a-little-noise-survives", check_a_little_noise_survives),
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
        print("\nNothing here went near a boundary, and the boundary is what is graded.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
