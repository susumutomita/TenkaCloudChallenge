"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the ten functions on the STATEMENT example (a = 5, b = 3,
x = 2, huge = 10**6, n = 13 — numbers no deployment can draw: x is never 2, huge is
always fifteen digits, n is always 17 or more), whose answers are printed in the
statement — so it can say PASS / FAIL. Part 2 prints what your functions return on
THIS deployment's numbers, which is exactly what your own python3 would print for each
drill line. Those are the values you paste into the answer fields. Nothing here knows
whether they are right; the Portal does.

The deployment's numbers come from the verifier's `GET /public` (Issue 537/543 option
B2): `fixtures/generate.py` does not ship in the participant image, because its
`setting` computes the expected values next to the public ones.

Run with `make test`, or press "Run public tests" in the Portal editor.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve()
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "starter"))
sys.path.insert(0, str(ROOT))

import unknown_x_drill as drill  # noqa: E402

from participant.evidence import public_evidence  # noqa: E402

# The ten line ids, in drill order. Hard-coded rather than imported: the module
# that defines them (fixtures/generate.py) stays out of this image on purpose.
LINES = (
    "covered",
    "sum-covered",
    "sum-plain",
    "same",
    "huge",
    "held",
    "recover",
    "guesses",
    "product",
    "wall",
)

# The statement's worked example. Excluded from every deployment (x is never 2, huge
# never this small, n never below 17), so these fixed values spoil nothing seed-specific.
L = dict(a=5, b=3, x=2, huge=10**6, n=13)


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
    ok &= _check("covered(5, 3, 2)", drill.covered(L["a"], L["b"], L["x"]), (7, 5))
    ok &= _check("sum_covered(5, 3, 2)", drill.sum_covered(L["a"], L["b"], L["x"]), 12)
    ok &= _check("sum_plain(5, 3, 2)", drill.sum_plain(L["a"], L["b"], L["x"]), 12)
    ok &= _check("same(5, 3, 2)", drill.same(L["a"], L["b"], L["x"]), True)
    ok &= _check("huge_gap(5, 3, 10**6)", drill.huge_gap(L["a"], L["b"], L["huge"]), 0)
    ok &= _check("held(5, 3, 2)", drill.held(L["a"], L["b"], L["x"]), (12, 4))
    ok &= _check("recover(5, 3, 2)", drill.recover(L["a"], L["b"], L["x"]), 8)
    ok &= _check("guesses(5, 2, 13)", drill.guesses(L["a"], L["x"], L["n"]), 13)
    ok &= _check("product(5, 3, 2)", drill.product(L["a"], L["b"], L["x"]), (35, 31, 4))
    ok &= _check("wall(5, 3, 2)", drill.wall(L["a"], L["b"], L["x"]), True)
    return bool(ok)


def part2() -> None:
    pub = public_evidence()["public"]

    calls = {
        "covered": lambda: drill.covered(pub["a"], pub["b"], pub["x"]),
        "sum-covered": lambda: drill.sum_covered(pub["a"], pub["b"], pub["x"]),
        "sum-plain": lambda: drill.sum_plain(pub["a"], pub["b"], pub["x"]),
        "same": lambda: drill.same(pub["a"], pub["b"], pub["x"]),
        "huge": lambda: drill.huge_gap(pub["a"], pub["b"], pub["huge"]),
        "held": lambda: drill.held(pub["a"], pub["b"], pub["x"]),
        "recover": lambda: drill.recover(pub["a"], pub["b"], pub["x"]),
        "guesses": lambda: drill.guesses(pub["a"], pub["x"], pub["n"]),
        "product": lambda: drill.product(pub["a"], pub["b"], pub["x"]),
        "wall": lambda: drill.wall(pub["a"], pub["b"], pub["x"]),
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
    print("== part 1: the statement example (a = 5, b = 3, x = 2, huge = 10**6, n = 13) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
