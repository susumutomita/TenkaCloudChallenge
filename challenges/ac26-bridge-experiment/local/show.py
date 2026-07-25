"""`make inspect` — show the worked example and the corrupted trace.

Everything here is derived from FLAG_SEED, so what you see is yours: copying
another learner's numbers will not help you.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import corrupted_trace, health_token, public_case

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    case = public_case(SEED)
    print("== checkpoint: environment ==")
    print(f"python           {sys.version.split()[0]}")
    print(f"health token     {health_token(SEED)}")
    print()
    print("== checkpoint: predict ==")
    print("Work this out on paper BEFORE running your code:")
    print(f"  start={case.start} step={case.step} rounds={case.rounds} modulus={case.modulus}")
    print("  submit the value after the last round.")
    print()
    print("== checkpoint: inspect ==")
    bad_case, trace, _broke_at = corrupted_trace(SEED)
    print(f"  start={bad_case.start} step={bad_case.step} "
          f"rounds={bad_case.rounds} modulus={bad_case.modulus}")
    print("  this trace was produced by an implementation that skipped the reduction")
    print("  on exactly one round. Submit the 0-based index of the FIRST entry that")
    print("  breaks the invariant 0 <= value < modulus.")
    print(f"  trace = {trace}")


if __name__ == "__main__":
    main()
