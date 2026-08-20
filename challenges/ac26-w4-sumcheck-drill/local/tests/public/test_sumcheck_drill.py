"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the twelve functions on the LECTURE example (F₁₁, inputs
(3, 1, 2, 4), the exact p₁ = 1 + 3t + 7t² and p₂ = 6t + 7t² from the Week 4 slides),
whose answers are printed in the statement — so it can say PASS / FAIL. Part 2 prints
what your functions return on THIS deployment's numbers, which is exactly what your own
python3 would print for each drill line. Those are the values you paste into the answer
fields. Nothing here knows whether they are right; the Portal does.

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

import sumcheck_drill as drill  # noqa: E402

from fixtures.generate import LINES, setting  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

# The lecture's example: F11, inputs (3, 1, 2, 4) → y0 = 4, y1 = 8, output 1.
# r1 = 2, r2 = 3, and the lie parameters d = 4, m = 2.
L = dict(p=11, y0=4, y1=8, c0=1, c1=3, c2=7, b1=6, b2=7, r1=2, r2=3, d=4, m=2)


def _only(name: str) -> bool:
    if "--only" not in sys.argv:
        return True
    return sys.argv[sys.argv.index("--only") + 1] in name


def _check(name: str, got, expected) -> bool:
    if not _only(name):
        return True
    if isinstance(got, list):
        got = tuple(got)
    ok = got == expected
    print(f"{'PASS' if ok else 'FAIL'}  {name}: got {got!r}, expected {expected!r}")
    return ok


def part1() -> bool:
    ok = True
    ok &= _check("layer(3, 1, 2, 4)", drill.layer(3, 1, 2, 4, 11), (4, 8, 1))
    ok &= _check("mle3(4, 8)", drill.mle3(4, 8, 11), (4, 8, 1))
    ok &= _check("grid(4, 8)", drill.grid(4, 8, 11), (0, 1, 0, 0))
    ok &= _check("grid_total(4, 8)", drill.grid_total(4, 8, 11), 1)
    ok &= _check("p1_sum(1, 3, 7)", drill.p1_sum(1, 3, 7, 11), 1)
    ok &= _check("round1(1, 3, 7, r1=2)", drill.round1(1, 3, 7, 2, 11), 2)
    ok &= _check("p2_sum(6, 7)", drill.p2_sum(6, 7, 11), 2)
    ok &= _check("final_check at r2=3", drill.final_check(4, 8, 6, 7, 2, 3, 11), (4, 4))
    ok &= _check("lie(d=4)", drill.lie(1, 3, 7, 4, 2, 11), (5, 9))
    ok &= _check(
        "lie_caught(d=4, m=2)",
        drill.lie_caught(1, 3, 7, 6, 7, 4, 2, 2, 3, 4, 8, 11),
        (9, 0, 4),
    )
    ok &= _check(
        "miss_points(d=4, m=2)",
        drill.miss_points(1, 3, 7, 6, 7, 4, 2, 2, 4, 8, 11),
        (1, 2),
    )
    return bool(ok)


def part2() -> None:
    pub = setting(SEED)["public"]
    p = pub["p"]

    def layer3():
        return drill.layer(pub["x1"], pub["x2"], pub["x3"], pub["x4"], p)

    def y01():
        value = layer3()
        return (0, 0) if value is None else (value[0], value[1])

    calls = {
        "circuit": layer3,
        "mle": lambda: drill.mle3(*y01(), p),
        "grid": lambda: drill.grid(*y01(), p),
        "grid-total": lambda: drill.grid_total(*y01(), p),
        "p1-sum": lambda: drill.p1_sum(pub["c0"], pub["c1"], pub["c2"], p),
        "p1-check": lambda: "(check it in your own REPL — line 6)",
        "round1": lambda: drill.round1(pub["c0"], pub["c1"], pub["c2"], pub["r1"], p),
        "p2-sum": lambda: drill.p2_sum(pub["b1"], pub["b2"], p),
        "final-check": lambda: drill.final_check(
            *y01(), pub["b1"], pub["b2"], pub["r1"], pub["r2"], p
        ),
        "lie": lambda: drill.lie(pub["c0"], pub["c1"], pub["c2"], pub["d"], pub["r1"], p),
        "lie-caught": lambda: drill.lie_caught(
            pub["c0"], pub["c1"], pub["c2"], pub["b1"], pub["b2"],
            pub["d"], pub["m"], pub["r1"], pub["r2"], *y01(), p,
        ),
        "miss-points": lambda: drill.miss_points(
            pub["c0"], pub["c1"], pub["c2"], pub["b1"], pub["b2"],
            pub["d"], pub["m"], pub["r1"], *y01(), p,
        ),
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
        print(f"  {line:12s} -> {value}")


def main() -> int:
    print("== part 1: the lecture example (F11, inputs (3, 1, 2, 4), p1 = 1 + 3t + 7t^2) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
