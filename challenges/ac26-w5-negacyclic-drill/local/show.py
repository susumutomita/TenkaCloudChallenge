"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the twelve lines. The values come from the verifier's
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
    print("  p, n           : the plaintext modulus and the ring degree (x^n + 1)")
    print("  q, D           : derived on paste — q = 2n (the rotation space), D = q/p (the scaling step)")
    print("  v              : the all-ones test polynomial — every coefficient 1, so a sign flip is visible")
    print("  noise_a, noise_b : the two input ciphertexts' noise (their sum shifts every rotation)")
    print("  dmax           : the largest noise total the parameters allow")
    print("  lo, hi         : two probe exponents — lo below the flip boundary, hi past it")
    print("  probes         : six exponents for the sign map, drawn across the whole 2n range")
    print()
    print("== what is NOT shown ==")
    print("  the value any line prints — the reduced exponents, the signs, the boundary,")
    print("  the rotation amounts, the constant terms, the margin. Those are yours to produce.")


if __name__ == "__main__":
    main()
