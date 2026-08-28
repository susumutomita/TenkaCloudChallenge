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
    print("  p, q, n : the plaintext modulus, the ciphertext modulus, the ring degree (x^n + 1)")
    print("  D       : derived on paste — q/p, the lift of one plaintext step (q is NOT 2n here)")
    print("  s       : the binary secret — visible in this drill: you are inside the bootstrapping")
    print("            machine, retracing in the clear what blind rotation does under encryption")
    print("  a, b    : one LWE ciphertext — the mask and the body b = a·s + D·m + e mod q")
    print("  shift   : the function the test polynomial evaluates: f(t) = (t + shift) % (p // 2)")
    print()
    print("== what is NOT shown ==")
    print("  the value any line prints — the phase, the plaintext and its noise, the test")
    print("  polynomial's coefficients, the rescaled values, the rotation index, the readout,")
    print("  the window and the edge. Those are yours to produce.")


if __name__ == "__main__":
    main()
