"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the twelve lines. The expected values are NOT printed:
they are what the learner's own lines produce. In particular the gate outputs, the
addresses, and both grand products are the learner's to compute.
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
    print(f"  p              : the gate field (mod {pub['p']})")
    print("  a0, b0, a1, b1 : the circuit inputs — gate 0 adds a0 + b0, gate 1 multiplies a1 * b1,")
    print("                   gate 2 adds the two outputs")
    print("  g              : the lying witness's shift — gate 2's left input, moved by g")
    print(f"  q, w           : the grand-product field (mod {pub['q']}) and the address base ω")
    print("  beta, gamma    : the verifier's randomness for the fingerprints")
    print()
    print("== what is NOT shown ==")
    print("  the gate outputs (line 1 computes them), the addresses, the fingerprints, and")
    print("  both grand products. Those are yours to produce.")


if __name__ == "__main__":
    main()
