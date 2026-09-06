"""`make inspect` / the Portal's inspect button — this deployment's numbers, as Python.

Everything is printed as assignment statements so the learner can paste the whole block
into `python3` and start trying the optional expressions. The values come from the verifier's
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
    print("== 紙/Portal で計算。手元の Python ならこのブロックを貼る ==")
    print("== calculate on paper/in the Portal; paste this block if using your own Python ==")
    print()
    print(evidence["assignments"])
    print()
    print("== what each name is ==")
    print("  a, b  : 元の2数 / the two original numbers")
    print("  x     : 共通の覆い / the common cover added to each")
    print("  huge  : 大きい比較用の覆い / the large comparison cover for huge")
    print("  n     : guesses だけの候補範囲 / full candidate range for guesses only")
    print()
    print("== what is NOT shown ==")
    print("  the value any line prints — the covered pair, either total, the difference,")
    print("  the candidate count, the leaked gap, the product and its leftover. Those are")
    print("  yours to produce.")


if __name__ == "__main__":
    main()
