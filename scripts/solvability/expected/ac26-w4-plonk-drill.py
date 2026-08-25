"""Mirror for ac26-w4-plonk-drill's eight direct-answer lines.

Every checkpoint is the value one line of Python prints against this deployment's numbers,
so the mirror is the deployment's `expected` table itself — one exact value per line per
seed. Tuples are mirrored as lists, the form the Portal's JSON decoding produces. Twelve
lines are typed; the eight graded ones are the platform's per-problem maximum.

The arithmetic below is typed out independently of `verifier/expected.py` (not imported
from it, not from `verifier.server`): this mirror exists to catch a bug the production
checker's own ground truth could carry, and importing that ground truth here would make
the audit's `oracle` check compare the checker to itself (#537 review). Only the *public*
state (`fixtures.generate.setting(seed)["public"]`) and the fixed `SIGMA` wiring table are
shared with the checker — those are the deployment's inputs, not its answer.
"""

import math


def _values(pub, sigma):
    p, q, w = pub["p"], pub["q"], pub["w"]
    a0, b0, a1, b1, g = pub["a0"], pub["b0"], pub["a1"], pub["b1"], pub["g"]
    beta, gamma = pub["beta"], pub["gamma"]

    o0 = (a0 + b0) % p
    o1 = (a1 * b1) % p
    o2 = (o0 + o1) % p

    rows = ((a0, b0, o0), (a1, b1, o1), (o0, o1, o2))
    bad2 = ((o0 + g) % p, o1, (o0 + g + o1) % p)
    bad = (rows[0], rows[1], bad2)

    def address_list(base):
        return [(pow(base, r, q) * (c + 1)) % q for r in range(3) for c in range(3)]

    addr = address_list(w)
    saddr = [
        (pow(w, sigma[(c, r)][1], q) * (sigma[(c, r)][0] + 1)) % q
        for r in range(3)
        for c in range(3)
    ]

    vals = [v for row in rows for v in row]
    vb = [v for row in bad for v in row]

    def product(values, addresses, b, c):
        return math.prod((v + b * a + c) % q for v, a in zip(values, addresses)) % q

    marks = [(v + beta * a + gamma) % q for v, a in zip(vals, addr)]
    f = product(vals, addr, beta, gamma)
    fs = product(vals, saddr, beta, gamma)
    fb = product(vb, addr, beta, gamma)
    gb = product(vb, saddr, beta, gamma)

    shared = [pair for i, pair in enumerate(zip(vb, addr)) if i not in (2, 6)]
    miss = sum(len({(-(v + b * a)) % q for v, a in shared}) for b in range(1, q))

    return {
        "outputs": (o0, o1, o2),
        "bad-row": bad2,
        "addresses": tuple(addr),
        "sigma-addresses": tuple(saddr),
        "marks": tuple(marks[:3]),
        "grand-product": (f, fs),
        "bad-product": (fb, gb),
        "miss-count": miss,
    }


def _line(name):
    def expected(server, seed):
        del server  # not used: the mirror reads public state directly, see module docstring
        import fixtures.generate as fixtures_generate

        pub = fixtures_generate.setting(seed)["public"]
        value = _values(pub, fixtures_generate.SIGMA)[name]
        return list(value) if isinstance(value, tuple) else value

    return expected


_LINES = (
    "outputs", "bad-row", "addresses", "sigma-addresses",
    "marks", "grand-product", "bad-product", "miss-count",
)

EXPECTED = {name: _line(name) for name in _LINES}


def _visible(server, seed):
    """Every number the learner is looking at, labelled as `show.py` labels it.

    The drill's whole point is that the answer is never on screen: the fields, the inputs,
    the randomness, and the lie's shift are shown, but the gate outputs, the addresses,
    the fingerprints, the products, and the miss count are not. Declaring them all lets the
    probe measure that claim on every seed.
    """
    del server
    import fixtures.generate as fixtures_generate

    return dict(fixtures_generate.setting(seed)["public"])


VISIBLE = {name: _visible for name in _LINES}
