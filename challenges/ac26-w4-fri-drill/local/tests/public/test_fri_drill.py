"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the twelve functions on the LECTURE example (F₁₇,
Q₀ = 15 + 5X + 5X², β = 3 → Q₁ = 5Y + 13, query x = 8 opening (1, 6), recovery
(12, 5) — the exact numbers from the Week 4 slides), whose answers are printed in
the statement — so it can say PASS / FAIL. Part 2 prints what your functions return
on THIS deployment's numbers, which is exactly what your own python3 would print for
each drill line. Those are the values you paste into the answer fields. Nothing here
knows whether they are right; the Portal does.

Run with `make test`, or press "run the public tests" in the Portal editor.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "starter"))
sys.path.insert(0, str(ROOT))

import fri_drill as drill  # noqa: E402

from fixtures.generate import LINES, setting  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

# The lecture's example: Q0 = 15 + 5X + 5X^2 over F17 (q3 = 0), beta = 3, x = 8,
# a second challenge beta2 = 2, and the swap difference d0 = 1, d1 = 1.
QS = (15, 5, 5, 0)
P = 17


def _only(name: str) -> bool:
    if "--only" not in sys.argv:
        return True
    return sys.argv[sys.argv.index("--only") + 1] in name


def _canon(value):
    if isinstance(value, (list, tuple)):
        return tuple(_canon(item) for item in value)
    return value


def _check(name: str, got, expected) -> bool:
    if not _only(name):
        return True
    ok = _canon(got) == _canon(expected)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: got {got!r}, expected {expected!r}")
    return ok


def part1() -> bool:
    ok = True
    ok &= _check("poly3(Q0)", drill.poly3(QS, P), (15, 8, 11))
    ok &= _check("split(Q0)", drill.split(QS, P), (3, 5))
    ok &= _check("identity_holds(Q0)", drill.identity_holds(QS, P), True)
    ok &= _check("fold(beta=3) -> Q1 = 5Y + 13", drill.fold(QS, 3, P), (13, 1, 6))
    ok &= _check("fold2(beta2=2)", drill.fold2(QS, 3, 2, P), 6)
    ok &= _check("query(x=8)", drill.query(QS, 8, P), (1, 6))
    ok &= _check("recover(x=8)", drill.recover(QS, 8, P), (12, 5, 12, 5))
    ok &= _check("consistency(x=8)", drill.consistency(QS, 3, 8, P), (10, 10))
    ok &= _check("cheat(d0=1, d1=1)", drill.cheat(QS, 3, 1, 1, P), (14, 3))
    ok &= _check("cheat_caught(x=8)", drill.cheat_caught(QS, 3, 8, 1, 1, P), (10, 7))
    ok &= _check("miss_points(d0=1, d1=1)", drill.miss_points(1, 1, P), (4, 13))
    ok &= _check("honest_all", drill.honest_all(QS, 3, P), ())
    return bool(ok)


def part2() -> None:
    pub = setting(SEED)["public"]
    p = pub["p"]
    qs = (pub["q0"], pub["q1"], pub["q2"], pub["q3"])
    calls = {
        "poly": lambda: drill.poly3(qs, p),
        "split": lambda: drill.split(qs, p),
        "identity": lambda: drill.identity_holds(qs, p),
        "fold": lambda: drill.fold(qs, pub["beta"], p),
        "fold2": lambda: drill.fold2(qs, pub["beta"], pub["beta2"], p),
        "query": lambda: drill.query(qs, pub["x"], p),
        "recover": lambda: drill.recover(qs, pub["x"], p),
        "consistency": lambda: drill.consistency(qs, pub["beta"], pub["x"], p),
        "cheat": lambda: drill.cheat(qs, pub["beta"], pub["d0"], pub["d1"], p),
        "cheat-caught": lambda: drill.cheat_caught(qs, pub["beta"], pub["x"], pub["d0"], pub["d1"], p),
        "miss-points": lambda: drill.miss_points(pub["d0"], pub["d1"], p),
        "honest-all": lambda: drill.honest_all(qs, pub["beta"], p),
    }
    print()
    print("== your values on THIS deployment (paste each into its answer field) ==")
    for line in LINES:
        try:
            value = calls[line]()
        except Exception as error:  # noqa: BLE001 - show the learner what broke
            value = f"(error: {type(error).__name__})"
        if value is None:
            value = "(not implemented yet)"
        print(f"  {line:13s} -> {value}")


def main() -> int:
    print("== part 1: the lecture example (F17, Q0 = 15 + 5X + 5X^2, beta = 3, x = 8) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
