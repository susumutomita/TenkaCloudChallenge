"""The PLONK drill's ground truth for the twelve lines, computed from public state alone.

`fixtures/generate.py` hands back only what `show.py` prints: `setting(seed)["public"]`.
This module is the only place that turns those public numbers into the value each
graded line is checked against. It is not exported from `fixtures/generate.py` and
nothing on the participant's reading path (`show.py`, the public tests) imports it —
see #537 and docs/curricula/advanced-cryptography-2026/TEMPLATE.md "Assurance scope".

Before #537, `fixtures/generate.py::setting()` returned this same dict directly, so
`from fixtures.generate import setting; setting(FLAG_SEED)["expected"]` handed back
every graded answer with no cryptography at all. Every value below is a pure function
of the public dict (gate inputs, the shift g, the address base w, and beta/gamma) plus
the fixed SIGMA/gate wiring, using the same construction `fixtures/generate.py` used to
pick w, beta and gamma in the first place — so recomputing it here, instead of shipping
a precomputed table, costs nothing except the one-import shortcut.

Same standing as `verifier/server.py` itself: this module still ships inside the
participant's own image (see the AC26 template's Assurance scope). That is misdelivery
prevention, not confidentiality — the difference #537 closes is that the answer is no
longer sitting behind a single, argument-free, participant-facing function call.
"""

from __future__ import annotations

import math

from fixtures.generate import SIGMA, setting


def expected_for(seed: str) -> dict[str, object]:
    """Every drill line's value, recomputed from `setting(seed)["public"]`."""
    pub = setting(seed)["public"]
    p, q, w = pub["p"], pub["q"], pub["w"]
    a0, b0, a1, b1, g = pub["a0"], pub["b0"], pub["a1"], pub["b1"], pub["g"]
    beta, gamma = pub["beta"], pub["gamma"]

    o0 = (a0 + b0) % p
    o1 = (a1 * b1) % p
    o2 = (o0 + o1) % p

    rows = ((a0, b0, o0), (a1, b1, o1), (o0, o1, o2))
    bad2 = ((o0 + g) % p, o1, (o0 + g + o1) % p)
    bad = (rows[0], rows[1], bad2)

    def address_list(base: int) -> list[int]:
        return [(pow(base, r, q) * (c + 1)) % q for r in range(3) for c in range(3)]

    addr = address_list(w)
    saddr = [
        (pow(w, SIGMA[(c, r)][1], q) * (SIGMA[(c, r)][0] + 1)) % q
        for r in range(3)
        for c in range(3)
    ]

    vals = [v for row in rows for v in row]
    vb = [v for row in bad for v in row]

    def product(values: list[int], addresses: list[int], b: int, c: int) -> int:
        return math.prod((v + b * a + c) % q for v, a in zip(values, addresses)) % q

    marks = [(v + beta * a + gamma) % q for v, a in zip(vals, addr)]
    f = product(vals, addr, beta, gamma)
    fs = product(vals, saddr, beta, gamma)
    fb = product(vb, addr, beta, gamma)
    gb = product(vb, saddr, beta, gamma)

    # The miss count. fb == gb exactly when some fingerprint SHARED by both products is 0.
    # Count, per b, the distinct c that zero a shared (value, address) pair.
    shared = [pair for i, pair in enumerate(zip(vb, addr)) if i not in (2, 6)]
    miss = sum(len({(-(v + b * a)) % q for v, a in shared}) for b in range(1, q))

    return {
        "outputs": (o0, o1, o2),
        "gate-eq": (0, 0, 0),
        "copy": (True, True),
        "bad-row": bad2,
        "bad-passes": ((0, 0, 0), (False, True)),
        "addresses": tuple(addr),
        "sigma-addresses": tuple(saddr),
        "marks": tuple(marks[:3]),
        "grand-product": (f, fs),
        "bad-product": (fb, gb),
        "multiset": (True, False),
        "miss-count": miss,
    }
