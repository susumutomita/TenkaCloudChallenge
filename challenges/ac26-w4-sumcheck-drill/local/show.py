"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the twelve lines. The expected values are NOT printed:
they are what the learner's own lines produce. In particular the circuit's output — the
prover's claim — is not printed; line 1 computes it.
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
    print("  x1, x2, x3, x4 : the circuit inputs — y0 = x1 + x2, y1 = x3 * x4, output = y0 + y1")
    print("  r1, r2         : the verifier's two random points (rounds 1 and 2)")
    print("  c0, c1, c2     : the honest prover's round-1 message, p1(t) = c0 + c1*t + c2*t^2")
    print("  b1, b2         : the honest prover's round-2 message, p2(t) = b1*t + b2*t^2")
    print("  d, m           : the lying prover's fudge — inflate the claim by d, cover with m")
    print()
    print("== what is NOT shown ==")
    print("  the circuit's output (the claim — line 1 computes it), and the value any line")
    print("  prints. Those are yours to produce.")


if __name__ == "__main__":
    main()
