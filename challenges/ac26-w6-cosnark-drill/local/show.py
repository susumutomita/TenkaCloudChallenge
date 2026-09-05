"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the fourteen lines. The values come from the verifier's
`GET /public` (Issue 537/543 option B2): this problem's `fixtures/generate.py` derives
the expected values in the same function as the public ones, so the module itself does
not ship in the participant image — only this public half travels. The expected values
are NOT printed: they are what the learner's own lines produce.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.evidence import public_evidence


def main() -> None:
    evidence = public_evidence()
    print("== この deploy の数（そのまま Python に貼る） ==")
    print("== paste this block into python3 first ==")
    print()
    print(evidence["assignments"])
    print()
    print("== what each name is ==")
    print("  p       : the field modulus every number below is taken mod p")
    print("  w       : the 2-wire witness [w0, w1] -- the secret being split, never")
    print("            reconstructed by a real co-SNARK prover")
    print("  r0, r1  : each wire's own share randomness -- the first party's half of")
    print("            w[0]'s and w[1]'s share, respectively")
    print("  ca, cb  : the public coefficient vectors of the two linear forms")
    print("            A = ca . w and B = cb . w")
    print("  a, b    : the Beaver triple's two random factors (c = a*b is not shown --")
    print("            you derive it yourself, the same way the prover does)")
    print("  ra,rb,rc: the Beaver triple's own share randomness, one per factor")
    print()
    print("== what is NOT shown ==")
    print("  the value any line prints -- each wire's second share, the linear forms A")
    print("  and B (on shares and directly), the naive share-wise product, the opened")
    print("  d and e, C's shares, and C itself. Those are yours to produce.")


if __name__ == "__main__":
    main()
