"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the twelve lines. The expected values are NOT printed:
they are what the learner's own lines produce.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import assignments, setting

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    pub = setting(SEED)["public"]
    print("== この deploy の数（そのまま Python に貼る） ==")
    print("== paste this block into python3 first ==")
    print()
    print(assignments(SEED))
    print()
    print("== what each name is ==")
    print(f"  p              : the field (mod {pub['p']})")
    print("  q0, q1, q2, q3 : the committed Q0's coefficients (the prover claims deg <= 3)")
    print("  beta, beta2    : the verifier's two folding challenges")
    print("  x              : the verifier's query point (Q0 opens at x and -x)")
    print("  d0, d1         : the dishonest fold's difference — Q1' = Q1 + d0 + d1*Y")
    print()
    print("== what is NOT shown ==")
    print("  the folded values, the openings, the recovered halves, and the miss points.")
    print("  Those are yours to produce.")


if __name__ == "__main__":
    main()
