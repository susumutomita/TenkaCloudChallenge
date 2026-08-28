"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the twelve functions on the LECTURE example (p = 8, n = 16,
q = 64 — the toy parameters of the Week 5 assignment, which this drill's deployments
never draw), with a fixed secret and ciphertext chosen here — so it can say PASS /
FAIL. Part 2 prints what your functions return on THIS deployment's numbers, which is
exactly what your own python3 would print for each drill line. Those are the values
you paste into the answer fields. Nothing here knows whether they are right; the
Portal does.

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

import rotation_drill as drill  # noqa: E402

from participant.evidence import public_evidence  # noqa: E402

# The twelve line ids, in drill order. Hard-coded rather than imported: the module
# that defines them (fixtures/generate.py) stays out of this image on purpose.
LINES = (
    "params",
    "phase",
    "split",
    "slots",
    "testpoly",
    "rescale",
    "index",
    "readout",
    "programmable",
    "window",
    "edge",
    "sweep",
)

# The lecture's toy parameters: p = 8, n = 16, q = 64 → D = 8, slot = 4. Excluded from
# every deployment, so these fixed values spoil nothing seed-specific. The secret and
# the ciphertext are this test's own: s = (1, 0, 1, 1), a = (21, 14, 63, 7), b = 44
# encrypts m = 2 with noise 1, and the test polynomial evaluates f(t) = (t + 1) % 4.
L = dict(p=8, q=64, n=16, s=(1, 0, 1, 1), a=(21, 14, 63, 7), b=44, shift=1)


def _only(name: str) -> bool:
    if "--only" not in sys.argv:
        return True
    return sys.argv[sys.argv.index("--only") + 1] in name


def _check(name: str, got, expected) -> bool:
    if not _only(name):
        return True
    if isinstance(got, tuple) and isinstance(expected, list):
        got = list(got)
    if isinstance(got, list) and isinstance(expected, tuple):
        got = tuple(got)
    ok = got == expected
    print(f"{'PASS' if ok else 'FAIL'}  {name}: got {got!r}, expected {expected!r}")
    return ok


def part1() -> bool:
    p, q, n, s, a, b, shift = L["p"], L["q"], L["n"], L["s"], L["a"], L["b"], L["shift"]
    ok = True
    ok &= _check("params(8, 64, 16)", drill.params(p, q, n), (8, 64, 16, 8))
    ok &= _check("phase", drill.phase(q, s, a, b), 17)
    ok &= _check("split", drill.split(p, q, s, a, b), (2, 1))
    ok &= _check("slots(8, 16)", drill.slots(p, n), 4)
    ok &= _check(
        "testvector: f in slot-wide centred runs",
        drill.testvector(p, n, shift),
        [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0],
    )
    ok &= _check("testpoly at the slot boundaries", drill.testpoly(p, n, shift), (1, 2, 3, 0))
    ok &= _check("rescale_one(64, 16, 44)", drill.rescale_one(q, n, b), 22)
    ok &= _check("rescale", drill.rescale(p, q, n, a, b), (4, 10, 22))
    ok &= _check("index", drill.index(q, n, s, a, b), 8)
    ok &= _check(
        "constant_at below the boundary (i=5)",
        drill.constant_at([1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0], 5),
        2,
    )
    ok &= _check(
        "constant_at past the boundary (i=22)",
        drill.constant_at([1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0], 22),
        -3,
    )
    ok &= _check("readout", drill.readout(p, q, n, s, a, b, shift), 3)
    ok &= _check("programmable = f(2)", drill.programmable(p, q, s, a, b, shift), 3)
    ok &= _check("window", drill.window(p, q, n, s, a, b, shift), 4)
    ok &= _check("edge", drill.edge(p, q, n, s, a, b, shift), 1)
    ok &= _check("sweep", drill.sweep(p, q, n, s, a, b, shift), True)
    return bool(ok)


def part2() -> None:
    pub = public_evidence()["public"]
    p, q, n = pub["p"], pub["q"], pub["n"]
    s, a, b, shift = pub["s"], pub["a"], pub["b"], pub["shift"]

    calls = {
        "params": lambda: drill.params(p, q, n),
        "phase": lambda: drill.phase(q, s, a, b),
        "split": lambda: drill.split(p, q, s, a, b),
        "slots": lambda: drill.slots(p, n),
        "testpoly": lambda: drill.testpoly(p, n, shift),
        "rescale": lambda: drill.rescale(p, q, n, a, b),
        "index": lambda: drill.index(q, n, s, a, b),
        "readout": lambda: drill.readout(p, q, n, s, a, b, shift),
        "programmable": lambda: drill.programmable(p, q, s, a, b, shift),
        "window": lambda: drill.window(p, q, n, s, a, b, shift),
        "edge": lambda: drill.edge(p, q, n, s, a, b, shift),
        "sweep": lambda: drill.sweep(p, q, n, s, a, b, shift),
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
    print("== part 1: the lecture example (p = 8, n = 16, q = 64 -> D = 8, slot = 4) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
