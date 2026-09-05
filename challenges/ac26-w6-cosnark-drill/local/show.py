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
    print("p: 割る数 / divisor; w: 二つの元の数 / two original numbers")
    print("r0,r1: wを隠す数 / masks for w; ca,cb: 掛ける数の組 / multipliers")
    print("a,b: 事前に用意する数 / prepared numbers; ra,rb,rc: それらを分ける数 / their masks")
    print("二人分を見渡す練習です。問題文の1行目から進めてください。")
    print("You observe both people. Continue from row 1 of the statement.")


if __name__ == "__main__":
    main()
