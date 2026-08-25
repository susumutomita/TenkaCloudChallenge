"""The SumCheck drill's ground truth for the twelve lines, computed from public state.

`fixtures/generate.py` hands back only what `show.py` prints: `setting(seed)["public"]`.
This module is the only place that turns those public numbers into the value each
graded line is checked against. It is not exported from `fixtures/generate.py` and
nothing on the participant's reading path (`show.py`, the public tests) imports it —
see #537 and docs/curricula/advanced-cryptography-2026/TEMPLATE.md "Assurance scope".

Before #537, `fixtures/generate.py::setting()` returned this same dict directly, so
`from fixtures.generate import setting; setting(FLAG_SEED)["expected"]` handed back
every graded answer with no cryptography at all. Every value below is a pure function
of the public dict — the circuit's own inputs, and the honest/lying prover messages the
statement already shows — so recomputing it here, instead of shipping a precomputed
table, costs nothing except the one-import shortcut.

Same standing as `verifier/server.py` itself: this module still ships inside the
participant's own image (see the AC26 template's Assurance scope). That is misdelivery
prevention, not confidentiality — the difference #537 closes is that the answer is no
longer sitting behind a single, argument-free, participant-facing function call.
"""

from __future__ import annotations

from fixtures.generate import setting


def expected_for(seed: str) -> dict[str, object]:
    """Every drill line's value, recomputed from `setting(seed)["public"]`."""
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
    sh = (d * (1 - r1)) % p

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
