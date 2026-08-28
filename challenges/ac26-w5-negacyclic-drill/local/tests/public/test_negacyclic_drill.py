"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the twelve functions on the LECTURE example (p = 8, n = 16 —
the toy parameters of the Week 5 assignment, which this drill's deployments never
draw), whose answers are printed in the statement — so it can say PASS / FAIL. Part 2
prints what your functions return on THIS deployment's numbers, which is exactly what
your own python3 would print for each drill line. Those are the values you paste into
the answer fields. Nothing here knows whether they are right; the Portal does.

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

import negacyclic_drill as drill  # noqa: E402

from participant.evidence import public_evidence  # noqa: E402

# The twelve line ids, in drill order. Hard-coded rather than imported: the module
# that defines them (fixtures/generate.py) stays out of this image on purpose.
LINES = (
    "params",
    "wrap",
    "signs",
    "boundary",
    "hazard",
    "encoding",
    "phases",
    "rotations",
    "constants",
    "nand",
    "noise-sweep",
    "margin",
)

# The lecture's toy parameters: p = 8, n = 16 → q = 32, D = 4. Excluded from every
# deployment, so these fixed probe values spoil nothing seed-specific.
L = dict(p=8, n=16, lo=3, hi=19, probes=(0, 5, 15, 16, 20, 31), noise_a=1, noise_b=0, dmax=1)


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
    v = [1] * L["n"]
    ok = True
    ok &= _check("params(8, 16)", drill.params(L["p"], L["n"]), (8, 32, 16, 4))
    ok &= _check("wrap(3, 19, 16)", drill.wrap(L["lo"], L["hi"], L["n"]), (6, -1, 22))
    ok &= _check("constant_at below the boundary (i=5)", drill.constant_at(v, 5), 1)
    ok &= _check("constant_at past the boundary (i=20)", drill.constant_at(v, 20), -1)
    ok &= _check("signs at (0, 5, 15, 16, 20, 31)", drill.signs(v, L["probes"]), (1, 1, 1, -1, -1, -1))
    ok &= _check("boundary", drill.boundary(v), 16)
    ok &= _check("hazard(lo=3)", drill.hazard(v, L["lo"]), (19, -1))
    ok &= _check("encoding(8)", drill.encoding(L["p"]), (7, 1))
    ok &= _check("phases(8)", drill.phases(L["p"]), (3, 1, 1, 7))
    ok &= _check(
        "rotations(noise 1+0)",
        drill.rotations(L["p"], L["n"], L["noise_a"], L["noise_b"]),
        (11, 3, 3, 27),
    )
    ok &= _check(
        "constants(noise 1+0)",
        drill.constants(L["p"], L["n"], L["noise_a"], L["noise_b"]),
        (1, 1, 1, -1),
    )
    ok &= _check("nand_table()", drill.nand_table(), (1, 1, 1, 0))
    ok &= _check("noise_sweep(dmax=1)", drill.noise_sweep(L["p"], L["n"], L["dmax"]), True)
    ok &= _check("margin(8, 16)", drill.margin(L["p"], L["n"]), 4)
    return bool(ok)


def part2() -> None:
    pub = public_evidence()["public"]
    v = [1] * pub["n"]

    calls = {
        "params": lambda: drill.params(pub["p"], pub["n"]),
        "wrap": lambda: drill.wrap(pub["low_probe"], pub["high_probe"], pub["n"]),
        "signs": lambda: drill.signs(v, tuple(pub["probes"])),
        "boundary": lambda: drill.boundary(v),
        "hazard": lambda: drill.hazard(v, pub["low_probe"]),
        "encoding": lambda: drill.encoding(pub["p"]),
        "phases": lambda: drill.phases(pub["p"]),
        "rotations": lambda: drill.rotations(pub["p"], pub["n"], pub["noise_a"], pub["noise_b"]),
        "constants": lambda: drill.constants(pub["p"], pub["n"], pub["noise_a"], pub["noise_b"]),
        "nand": lambda: drill.nand_table(),
        "noise-sweep": lambda: drill.noise_sweep(pub["p"], pub["n"], pub["dmax"]),
        "margin": lambda: drill.margin(pub["p"], pub["n"]),
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
    print("== part 1: the lecture example (p = 8, n = 16 -> q = 32, D = 4) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
