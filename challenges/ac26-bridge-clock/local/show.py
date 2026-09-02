"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start typing the ten lines. The values come from the verifier's
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
    print("  n              : the size of the clock — this world holds only 0..n-1")
    print("  u, v           : two numbers larger than one turn, for watching the wrap")
    print("  secret, second : the number being hidden, and the one the last lines reuse the cover on")
    print("  cover          : the cover, drawn at random")
    print()
    print("== what is NOT shown ==")
    print("  the value any line prints — where u and v land, the covered value, the")
    print("  cover counts, the reused pair and its difference. Those are yours to produce.")


if __name__ == "__main__":
    main()
