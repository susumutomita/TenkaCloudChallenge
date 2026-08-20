"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the twelve lines. The expected values are NOT printed:
they are what the learner's own lines produce. The secret of the attack key is not
printed either — extracting it is line 11.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import assignments, setting

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    cfg = setting(SEED)
    pub = cfg["public"]
    print("== この deploy の数（そのまま Python に貼る） ==")
    print("== paste this block into python3 first ==")
    print()
    print(assignments(SEED))
    print()
    print("== what each name is ==")
    print(f"  curve      : y^2 = x^3 + {pub['a']}x + {pub['b']}  (mod {pub['p']}),  G = {pub['G']}")
    print("  t          : a trial field element for lines 1-2")
    print(f"  Q          : another point on the curve, {pub['Q']}, for lines 3-4")
    print("  x, r, e    : your secret key, your nonce, the verifier's challenge (lines 7-10)")
    print("  P1         : a DIFFERENT signer's public key, who reused one nonce for two")
    print("               challenges: (e1, s1) and (e2, s2). Its secret is not shown (line 11).")
    print("  p2, a2, b2, G2, x2, r2, e2p : the transfer curve and its key/nonce/challenge (line 12)")
    print()
    print("== what is NOT shown ==")
    print("  the order n of G (line 6 counts it), the attack signer's secret (line 11),")
    print("  and the value any line prints — those are yours to produce.")


if __name__ == "__main__":
    main()
