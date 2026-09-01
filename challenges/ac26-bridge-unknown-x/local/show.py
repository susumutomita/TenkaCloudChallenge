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
    print("  a, b  : the two numbers being added for you")
    print("  x     : the small cover laid over each of them")
    print("  huge  : the fifteen-digit cover that replaces x in line 5")
    print("  n     : the size of the candidate range for the counting line")
    print()
    print("== what is NOT shown ==")
    print("  the value any line prints — the covered pair, either total, the difference,")
    print("  the candidate count, the product and its leftover. Those are yours to produce.")


if __name__ == "__main__":
    main()
