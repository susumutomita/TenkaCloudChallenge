"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the ten functions on the STATEMENT example (n = 10, u = 23,
v = 17, secret = 4, second = 7, cover = 9 — a clock size no deployment can draw: n is
always 12 or more), whose answers are printed in the statement — so it can say
PASS / FAIL. Part 2 prints what your functions return on THIS deployment's numbers,
which is exactly what your own python3 would print for each drill line. Those are the
values you paste into the answer fields. Nothing here knows whether they are right;
the Portal does.

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

import clock_drill as drill  # noqa: E402

from participant.evidence import public_evidence  # noqa: E402

# The ten line ids, in drill order. Hard-coded rather than imported: the module
# that defines them (fixtures/generate.py) stays out of this image on purpose.
LINES = (
    "wrap",
    "add",
    "mul",
    "cover",
    "uncover",
    "every",
    "count",
    "reuse",
    "leak",
    "same-diff",
)

# The statement's worked example. Excluded from every deployment (the clock is always
# 12 or more), so these fixed values spoil nothing seed-specific.
L = dict(n=10, u=23, v=17, secret=4, second=7, cover=9)


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
    ok &= _check("wrap(23, 17, 10)", drill.wrap(L["u"], L["v"], L["n"]), (3, 7))
    ok &= _check("add(23, 17, 10)", drill.add(L["u"], L["v"], L["n"]), (0, 0, 0))
    ok &= _check("mul(23, 17, 10)", drill.mul(L["u"], L["v"], L["n"]), (1, 1, 0))
    ok &= _check("covered(4, 9, 10)", drill.covered(L["secret"], L["cover"], L["n"]), 3)
    ok &= _check("uncovered(4, 9, 10)", drill.uncovered(L["secret"], L["cover"], L["n"]), 4)
    ok &= _check("every(4, 9, 10)", drill.every(L["secret"], L["cover"], L["n"]), (1, 1, 1))
    ok &= _check("count(4, 9, 10)", drill.count(L["secret"], L["cover"], L["n"]), 10)
    ok &= _check(
        "reuse(4, 7, 9, 10)", drill.reuse(L["secret"], L["second"], L["cover"], L["n"]), (3, 6)
    )
    ok &= _check("leak(4, 7, 9, 10)", drill.leak(L["secret"], L["second"], L["cover"], L["n"]), 7)
    ok &= _check(
        "same_diff(4, 7, 9, 10)",
        drill.same_diff(L["secret"], L["second"], L["cover"], L["n"]),
        True,
    )
    return bool(ok)


def part2() -> None:
    pub = public_evidence()["public"]

    calls = {
        "wrap": lambda: drill.wrap(pub["u"], pub["v"], pub["n"]),
        "add": lambda: drill.add(pub["u"], pub["v"], pub["n"]),
        "mul": lambda: drill.mul(pub["u"], pub["v"], pub["n"]),
        "cover": lambda: drill.covered(pub["secret"], pub["cover"], pub["n"]),
        "uncover": lambda: drill.uncovered(pub["secret"], pub["cover"], pub["n"]),
        "every": lambda: drill.every(pub["secret"], pub["cover"], pub["n"]),
        "count": lambda: drill.count(pub["secret"], pub["cover"], pub["n"]),
        "reuse": lambda: drill.reuse(pub["secret"], pub["second"], pub["cover"], pub["n"]),
        "leak": lambda: drill.leak(pub["secret"], pub["second"], pub["cover"], pub["n"]),
        "same-diff": lambda: drill.same_diff(
            pub["secret"], pub["second"], pub["cover"], pub["n"]
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
    print("== part 1: the statement example (n = 10, u = 23, v = 17, secret = 4, second = 7, cover = 9) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
