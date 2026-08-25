"""Hidden derivation of the twelve SumCheck drill lines' values.

The participant image carries `fixtures/generate.py`'s public assignment statements
only (Issue 543/537): the field, the circuit inputs, the verifier's random points, the
honest prover's coefficients, and the lying prover's fudge parameters. This module is
never copied into the participant Docker stage (see ../Dockerfile) -- it re-derives
every line's value from those same public numbers, with the exact arithmetic the
problem statement walks the learner through by hand. Nothing here is a second source of
entropy: every value below is a pure function of `setting(seed)["public"]`.

History (#537/#543): a first pass moved this computation out of `fixtures/generate.py`
and into this module, but left it inside the same single, participant-runnable Docker
stage as everything else, so `from verifier.expected import expected_for` still worked
from inside a learner's own container -- the module name changed, the leak did not. This
problem's `local/` now splits into a public `participant/` Workbench stage and a
separate, unpublished `verifier` stage that alone carries this file and
`tests/hidden/` (see ../Dockerfile and ../docker-compose.yml), so this module is no
longer reachable from the participant image at all.
"""

from __future__ import annotations

from fixtures.generate import setting


def expected_for(seed: str) -> dict[str, object]:
    """Every one of the twelve lines' values, keyed by line id.

    Four of the twelve (`grid-total`, `p1-sum`, `p1-check`, `p2-sum`) are ungraded --
    the platform's per-problem checkpoint maximum is eight -- but `tests/hidden/
    check_sumcheck_drill.py` still checks the reference implementation produces them,
    so they are derived here too rather than only the eight in `fixtures.generate.GRADED`.
    """
    pub = setting(seed)["public"]
    p = pub["p"]
    x1, x2, x3, x4 = pub["x1"], pub["x2"], pub["x3"], pub["x4"]
    r1, r2 = pub["r1"], pub["r2"]
    c0, c1, c2 = pub["c0"], pub["c1"], pub["c2"]
    b1, b2 = pub["b1"], pub["b2"]
    d, m = pub["d"], pub["m"]

    y0 = (x1 + x2) % p
    y1 = (x3 * x4) % p
    out = (y0 + y1) % p

    def w1(z: int) -> int:
        return (y0 * (1 - z) + y1 * z) % p

    def g0(a: int, b: int) -> int:
        return ((1 - a) * b * (w1(a) + w1(b))) % p

    def p1(t: int) -> int:
        return (c0 + c1 * t + c2 * t * t) % p

    def p2(t: int) -> int:
        return (b1 * t + b2 * t * t) % p

    def p1c(t: int) -> int:
        return (p1(t) + d * (1 - t)) % p

    # p1c(r1) is the cover story's first round; the second round covers the gap between
    # it and the honest p2's own sum, then adds a two-point-sum-neutral term.
    sh = (d * (1 - r1)) % p

    def p2c(t: int) -> int:
        return (p2(t) + sh * (1 - t) + m * t * (1 - t)) % p

    return {
        "circuit": (y0, y1, out),
        "mle": (w1(0), w1(1), w1(2)),
        "grid": (g0(0, 0), g0(0, 1), g0(1, 0), g0(1, 1)),
        "grid-total": sum(g0(a, b) for a in (0, 1) for b in (0, 1)) % p,
        "p1-sum": (p1(0) + p1(1)) % p,
        "p1-check": True,
        "round1": p1(r1),
        "p2-sum": (p2(0) + p2(1)) % p,
        "final-check": (p2(r2), g0(r1, r2)),
        "lie": ((p1c(0) + p1c(1)) % p, p1c(r1)),
        "lie-caught": ((p2c(0) + p2c(1)) % p, p2c(r2), g0(r1, r2)),
        "miss-points": tuple(sorted(t for t in range(p) if p2c(t) == g0(r1, t))),
    }
