"""The FRI drill's ground truth for the twelve lines, computed from public state alone.

`fixtures/generate.py` hands back only what `show.py` prints: `setting(seed)["public"]`.
This module is the only place that turns those public numbers into the value each
graded line is checked against. It is not exported from `fixtures/generate.py` and
nothing on the participant's reading path (`show.py`, the public tests) imports it —
see #537 and docs/curricula/advanced-cryptography-2026/TEMPLATE.md "Assurance scope".

Before #537, `fixtures/generate.py::setting()` returned this same dict directly, so
`from fixtures.generate import setting; setting(FLAG_SEED)["expected"]` handed back
every graded answer with no cryptography at all. Every value below is a pure function
of the public dict — the same evaluation the drill statement asks the learner to do —
so recomputing it here, instead of shipping a precomputed table, costs nothing except
the one-import shortcut.

The one line that is not a direct restatement of a public value is `miss-points`: the
dishonest fold's difference `d0 + d1*Y` vanishes at exactly one Y, and that Y was
constructed (see `fixtures/generate.py`) as a square s^2, so its two square roots are
the pair of points the drill names. p is a small toy prime, so scanning for the roots
is exact and cheap — the same brute force the drill statement itself suggests.

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
    q0, q1, q2, q3 = pub["q0"], pub["q1"], pub["q2"], pub["q3"]
    beta, beta2 = pub["beta"], pub["beta2"]
    x = pub["x"]
    d0, d1 = pub["d0"], pub["d1"]

    def Q(X: int) -> int:
        return (q0 + q1 * X + q2 * X * X + q3 * X * X * X) % p

    def Qe(Y: int) -> int:
        return (q0 + q2 * Y) % p

    def Qo(Y: int) -> int:
        return (q1 + q3 * Y) % p

    def Q1(Y: int) -> int:
        return (Qe(Y) + beta * Qo(Y)) % p

    def Q1c(Y: int) -> int:
        return (Q1(Y) + d0 + d1 * Y) % p

    inv2 = pow(2, p - 2, p)
    xx = x * x % p
    re = (Q(x) + Q((-x) % p)) * inv2 % p
    ro = (Q(x) - Q((-x) % p)) * pow(2 * x, p - 2, p) % p
    c, d = Q1(0), (Q1(1) - Q1(0)) % p

    y_root = (-d0 * pow(d1, p - 2, p)) % p
    roots = sorted(candidate for candidate in range(p) if (candidate * candidate) % p == y_root)

    return {
        "poly": (Q(0), Q(1), Q(2)),
        "split": (Qe(1), Qo(1)),
        "identity": True,
        "fold": (Q1(0), Q1(1), Q1(2)),
        "fold2": (c + beta2 * d) % p,
        "query": (Q(x), Q((-x) % p)),
        "recover": (re, ro, Qe(xx), Qo(xx)),
        "consistency": ((re + beta * ro) % p, Q1(xx)),
        "cheat": (Q1c(0), Q1c(1)),
        "cheat-caught": ((re + beta * ro) % p, Q1c(xx)),
        "miss-points": (roots[0], roots[1]),
        "honest-all": (),
    }
