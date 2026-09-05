"""Public tests — readable, and deliberately not the grader.

Two parts. Part 1 checks the fourteen functions on the ASSIGNMENT's own worked example
(modulus 97, witness [3, 5], coefficients [1, 2] / [4, 1], Beaver triple a=5/b=9/c=45 --
the toy parameters of the Week 6 assignment `co-snark-prove`, which this drill's
deployments never draw), with the README's own share randomness, so it can say PASS /
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

import co_snark_drill as drill  # noqa: E402

from participant.evidence import public_evidence  # noqa: E402

# The fourteen line ids, in drill order. Hard-coded rather than imported: the module
# that defines them (fixtures/generate.py) stays out of this image on purpose.
LINES = (
    "witness",
    "shares",
    "reconstruct",
    "noleak",
    "ashares",
    "aopen",
    "bshares",
    "crossmul",
    "triple",
    "beaveropen",
    "cshares",
    "csum",
    "expand",
    "nolink",
)

# The assignment `co-snark-prove`'s own worked example: modulus 97, witness [3, 5],
# coeffs_a = [1, 2] (A = 1*3+2*5=13), coeffs_b = [4, 1] (B = 4*3+1*5=17), Beaver triple
# a=5, b=9, c=45, with the README's own share randomness (a_sh=[1,4], b_sh=[4,5],
# c_sh=[20,25]). Excluded from every deployment, so these fixed values spoil nothing
# seed-specific.
L = dict(p=97, w=(3, 5), r0=1, r1=2, ca=(1, 2), cb=(4, 1), a=5, b=9, ra=1, rb=4, rc=20)


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
    p, w = L["p"], L["w"]
    r0, r1, ca, cb = L["r0"], L["r1"], L["ca"], L["cb"]
    a, b, ra, rb, rc = L["a"], L["b"], L["ra"], L["rb"], L["rc"]
    ok = True
    ok &= _check("witness(97, [3, 5])", drill.witness(p, w), (97, (3, 5)))
    ok &= _check("shares: (w0[1], w1[1])", drill.shares(p, w, r0, r1), (2, 3))
    ok &= _check("reconstruct: back to the witness", drill.reconstruct(p, w, r0, r1), (3, 5))
    ok &= _check(
        "noleak: r0 stays put across three secrets",
        drill.noleak(p, w, r0),
        # Candidates are w[0]=3, p//2=48, p-1=96; subtract the fixed r0=1.
        [(1, 2), (1, 47), (1, 95)],
    )
    ok &= _check("ashares: A's shares", drill.ashares(p, w, r0, r1, ca), [5, 8])
    ok &= _check("aopen: A opened vs computed directly", drill.aopen(p, w, r0, r1, ca), (13, 13))
    ok &= _check(
        "bshares: B's shares and B opened", drill.bshares(p, w, r0, r1, cb), (6, 11, 17)
    )
    ok &= _check(
        "crossmul: the share-wise product does NOT equal A*B",
        drill.crossmul(p, w, r0, r1, ca, cb),
        (21, 27),
    )
    ok &= _check("triple: a, b, c=a*b all confirmed", drill.triple(p, a, b, ra, rb, rc), (5, 9, 45, 45))
    ok &= _check(
        "beaveropen: the one round of communication",
        drill.beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb),
        (8, 8),
    )
    ok &= _check(
        "cshares: C's shares", drill.cshares(p, w, r0, r1, ca, cb, a, b, ra, rb, rc), [27, 0]
    )
    ok &= _check(
        "csum: C opened", drill.csum(p, w, r0, r1, ca, cb, a, b, ra, rb, rc), 27
    )
    ok &= _check(
        "expand: the textbook identity, also 27",
        drill.expand(p, w, r0, r1, ca, cb, a, b, ra, rb),
        27,
    )
    ok &= _check(
        "nolink: three candidate A's, each with a matching a",
        drill.nolink(p, w, r0, r1, ca, cb, a, b, ra, rb),
        [(13, 5), (45, 37), (77, 69)],
    )
    return bool(ok)


def part2() -> None:
    pub = public_evidence()["public"]
    p, w = pub["p"], pub["w"]
    r0, r1, ca, cb = pub["r0"], pub["r1"], pub["ca"], pub["cb"]
    a, b, ra, rb, rc = pub["a"], pub["b"], pub["ra"], pub["rb"], pub["rc"]

    calls = {
        "witness": lambda: drill.witness(p, w),
        "shares": lambda: drill.shares(p, w, r0, r1),
        "reconstruct": lambda: drill.reconstruct(p, w, r0, r1),
        "noleak": lambda: drill.noleak(p, w, r0),
        "ashares": lambda: drill.ashares(p, w, r0, r1, ca),
        "aopen": lambda: drill.aopen(p, w, r0, r1, ca),
        "bshares": lambda: drill.bshares(p, w, r0, r1, cb),
        "crossmul": lambda: drill.crossmul(p, w, r0, r1, ca, cb),
        "triple": lambda: drill.triple(p, a, b, ra, rb, rc),
        "beaveropen": lambda: drill.beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb),
        "cshares": lambda: drill.cshares(p, w, r0, r1, ca, cb, a, b, ra, rb, rc),
        "csum": lambda: drill.csum(p, w, r0, r1, ca, cb, a, b, ra, rb, rc),
        "expand": lambda: drill.expand(p, w, r0, r1, ca, cb, a, b, ra, rb),
        "nolink": lambda: drill.nolink(p, w, r0, r1, ca, cb, a, b, ra, rb),
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
    print("== part 1: the assignment's own worked example (modulus 97, witness [3, 5]) ==")
    ok = part1()
    part2()
    print()
    print("public tests:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
