"""Public examples, followed by the learner's own outputs on public Inspect values.

Part 2 displays outputs, not verdicts. Submit each printed value to its matching ID.
No fixtures, expected answers, seeds or reference implementation are imported here.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "starter"))
sys.path.insert(0, str(ROOT))
import clock_drill as drill
from participant.evidence import public_evidence

LINES = ("add", "mul", "cover", "uncover", "every", "count", "reuse", "leak")


def calls(pub):
    return {
        "add": lambda: drill.add(pub["u"], pub["v"], pub["n"]),
        "mul": lambda: drill.mul(pub["u"], pub["v"], pub["n"]),
        "cover": lambda: drill.covered(pub["secret"], pub["cover"], pub["n"]),
        "uncover": lambda: drill.uncovered(pub["secret"], pub["cover"], pub["n"]),
        "every": lambda: drill.every(pub["secret"], pub["cover"], pub["n"]),
        "count": lambda: drill.count(pub["secret"], pub["cover"], pub["n"]),
        "reuse": lambda: drill.reuse(pub["known_first"], pub["seen1"], pub["seen2"], pub["n"]),
        "leak": lambda: drill.leak(pub["known_first"], pub["seen1"], pub["seen2"], pub["n"]),
    }


def _only(name):
    return "--only" not in sys.argv or sys.argv[sys.argv.index("--only") + 1] in name


def part1():
    pub = dict(n=5, u=8, v=9, secret=4, cover=3, known_first=4, seen1=2, seen2=4)
    expected = dict(add=[2,2,0], mul=[2,2,0], cover=2, uncover=4,
                    every=[3,2,2], count=5, leak=1)
    ok = True
    for name, call in calls(pub).items():
        if not _only(name):
            continue
        try:
            got = call()
            if name == "reuse":
                good = (isinstance(got, (tuple,list)) and len(got) == 3
                        and all(type(x) is int and 0 <= x < 5 for x in got)
                        and got[0] != 4 and (got[0]+got[2]) % 5 == 2
                        and (got[1]+got[2]) % 5 == 4)
            else:
                value = list(got) if isinstance(got, tuple) else got
                good = value == expected[name]
                if isinstance(expected[name], list):
                    good = good and isinstance(value, list) and all(type(x) is int for x in value)
                else:
                    good = good and type(value) is int
        except Exception as error:
            got, good = type(error).__name__, False
        print(f"{'PASS' if good else 'FAIL'} {name}: your value {got!r}")
        ok = ok and good
    return ok


def part2():
    print("== 自分の出力 / Your outputs: copy to the matching answer fields ==")
    for name, call in calls(public_evidence()["public"]).items():
        try:
            got = call()
            value = json.dumps(got) if isinstance(got, (tuple,list)) else str(got)
            if got is None:
                value = "(not implemented yet)"
        except Exception as error:
            value = f"(error: {type(error).__name__})"
        print(f"  {name:12s} -> {value}")


def main():
    print("== 本文の例 / Statement example (n=5) ==")
    ok = part1()
    part2()
    print("public examples:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
