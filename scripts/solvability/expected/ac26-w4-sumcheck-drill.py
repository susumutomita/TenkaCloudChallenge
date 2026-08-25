"""Mirror for ac26-w4-sumcheck-drill's eight direct-answer lines.

Every checkpoint is the value one line of Python prints against this deployment's numbers,
so the mirror is the deployment's `expected` table itself — one exact value per line per
seed. Tuples are mirrored as lists, the form the Portal's JSON decoding produces. Twelve
lines are typed; the eight graded ones are the platform's per-problem maximum.

The arithmetic below is typed out independently of `verifier/expected.py` (not imported
from it, not from `verifier.server`): this mirror exists to catch a bug the production
checker's own ground truth could carry, and importing that ground truth here would make
the audit's `oracle` check compare the checker to itself (#537 review). Only the *public*
state (`fixtures.generate.setting(seed)["public"]`) is shared with the checker — that is
the deployment's input, not its answer. `verifier/expected.py` itself (Issue 543/537) now
lives only in a separate, unpublished verifier Docker stage that the participant image
never carries; `server`, the loaded `verifier.server` module, is accepted for interface
parity with every other problem's mirror but is not read here.
"""


def _values(pub):
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

    def w1(z):
        return (y0 * (1 - z) + y1 * z) % p

    def g0(a, b):
        return ((1 - a) * b * (w1(a) + w1(b))) % p

    def p1(t):
        return (c0 + c1 * t + c2 * t * t) % p

    def p2(t):
        return (b1 * t + b2 * t * t) % p

    def p1c(t):
        return (p1(t) + d * (1 - t)) % p

    def p2c(t):
        return (p2(t) + sh * (1 - t) + m * t * (1 - t)) % p

    return {
        "circuit": (y0, y1, out),
        "mle": (w1(0), w1(1), w1(2)),
        "grid": (g0(0, 0), g0(0, 1), g0(1, 0), g0(1, 1)),
        "round1": p1(r1),
        "final-check": (p2(r2), g0(r1, r2)),
        "lie": ((p1c(0) + p1c(1)) % p, p1c(r1)),
        "lie-caught": ((p2c(0) + p2c(1)) % p, p2c(r2), g0(r1, r2)),
        "miss-points": tuple(sorted(t for t in range(p) if p2c(t) == g0(r1, t))),
    }


def _line(name):
    def expected(server, seed):
        del server  # not used: the mirror reads public state directly, see module docstring
        import fixtures.generate as fixtures_generate

        value = _values(fixtures_generate.setting(seed)["public"])[name]
        return list(value) if isinstance(value, tuple) else value

    return expected


_LINES = (
    "circuit", "mle", "grid", "round1",
    "final-check", "lie", "lie-caught", "miss-points",
)

EXPECTED = {name: _line(name) for name in _LINES}


def _visible(server, seed):
    """Every number the learner is looking at, labelled as `show.py` labels it.

    The drill's whole point is that the answer is never on screen: the field, the inputs,
    the randomness, the coefficients, and the lie parameters are shown, but the circuit's
    output, the round values, and the miss points are not. Declaring them all lets the
    probe measure that claim on every seed.
    """
    del server
    import fixtures.generate as fixtures_generate

    return dict(fixtures_generate.setting(seed)["public"])


VISIBLE = {name: _visible for name in _LINES}
