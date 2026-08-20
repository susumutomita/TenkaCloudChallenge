"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the twelve functions on the LECTURE example (F₁₇ gate table
(3,1,4)/(2,4,8)/(4,8,12), F₁₀₁ grand product with ω = 10, β = 5, γ = 7 — the exact
(69, 69) and (88, 75) from the Week 4 slides), whose answers are printed in the
statement — so it can say PASS / FAIL. Part 2 prints what your functions return on THIS
deployment's numbers, which is exactly what your own python3 would print for each drill
line. Those are the values you paste into the answer fields. Nothing here knows whether
they are right; the Portal does.

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

import plonk_drill as drill  # noqa: E402

from fixtures.generate import LINES, setting  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

ROWS = [(3, 1, 4), (2, 4, 8), (4, 8, 12)]
BAD = [(3, 1, 4), (2, 4, 8), (5, 8, 13)]


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
    ok &= _check("outputs(3, 1, 2, 4)", drill.outputs(3, 1, 2, 4, 17), (4, 8, 12))
    ok &= _check("gate_eq(rows)", drill.gate_eq(ROWS, 17), (0, 0, 0))
    ok &= _check("copy_check(rows)", drill.copy_check(ROWS), (True, True))
    ok &= _check("bad_row(4, 8, g=1)", drill.bad_row(4, 8, 1, 17), (5, 8, 13))
    ok &= _check("bad_passes", drill.bad_passes(ROWS, BAD, 17), ((0, 0, 0), (False, True)))
    ok &= _check("addresses(10, 101)", drill.addresses(10, 101), (1, 2, 3, 10, 20, 30, 100, 99, 98))
    ok &= _check(
        "sigma_addresses(10, 101)", drill.sigma_addresses(10, 101), (1, 2, 100, 10, 20, 99, 3, 30, 98)
    )
    ok &= _check("marks3(beta=5, gamma=7)", drill.marks3(ROWS, 10, 101, 5, 7), (15, 18, 26))
    ok &= _check("grand_product(rows)", drill.grand_product(ROWS, 10, 101, 5, 7), (69, 69))
    ok &= _check("bad_product(bad)", drill.bad_product(BAD, 10, 101, 5, 7), (88, 75))
    ok &= _check("multiset", drill.multiset(ROWS, BAD, 10, 101), (True, False))
    ok &= _check("miss_count(bad)", drill.miss_count(BAD, 10, 101), 681)
    return bool(ok)


def part2() -> None:
    pub = setting(SEED)["public"]
    p, q, w, beta, gamma = pub["p"], pub["q"], pub["w"], pub["beta"], pub["gamma"]

    def tables():
        value = drill.outputs(pub["a0"], pub["b0"], pub["a1"], pub["b1"], p)
        if value is None:
            return None, None
        o0, o1, o2 = value
        rows = [(pub["a0"], pub["b0"], o0), (pub["a1"], pub["b1"], o1), (o0, o1, o2)]
        bad2 = drill.bad_row(o0, o1, pub["g"], p)
        bad = [rows[0], rows[1], bad2] if bad2 else None
        return rows, bad

    rows, bad = tables()
    calls = {
        "outputs": lambda: drill.outputs(pub["a0"], pub["b0"], pub["a1"], pub["b1"], p),
        "gate-eq": lambda: drill.gate_eq(rows, p) if rows else None,
        "copy": lambda: drill.copy_check(rows) if rows else None,
        "bad-row": lambda: bad[2] if bad else None,
        "bad-passes": lambda: drill.bad_passes(rows, bad, p) if bad else None,
        "addresses": lambda: drill.addresses(w, q),
        "sigma-addresses": lambda: drill.sigma_addresses(w, q),
        "marks": lambda: drill.marks3(rows, w, q, beta, gamma) if rows else None,
        "grand-product": lambda: drill.grand_product(rows, w, q, beta, gamma) if rows else None,
        "bad-product": lambda: drill.bad_product(bad, w, q, beta, gamma) if bad else None,
        "multiset": lambda: drill.multiset(rows, bad, w, q) if bad else None,
        "miss-count": lambda: drill.miss_count(bad, w, q) if bad else None,
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
        print(f"  {line:15s} -> {value}")


def main() -> int:
    print("== part 1: the lecture example (F17 gate table, F101 product, beta=5, gamma=7) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
