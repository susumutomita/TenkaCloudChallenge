"""Mirror for ac26-w4-fri-drill's eight direct-answer lines.

Every checkpoint is the value one line of Python prints against this deployment's numbers,
so the mirror is the deployment's `expected` table itself — one exact value per line per
seed. Tuples are mirrored as lists, the form the Portal's JSON decoding produces. Twelve
lines are typed; the eight graded ones are the platform's per-problem maximum.

The arithmetic below is typed out independently of `verifier/expected.py` (not imported
from it, not from `verifier.server`): this mirror exists to catch a bug the production
checker's own ground truth could carry, and importing that ground truth here would make
the audit's `oracle` check compare the checker to itself (#537 review). Only the *public*
state (`fixtures.generate.setting(seed)["public"]`) is shared with the checker — that is
the deployment's input, not its answer.
"""


def _values(pub):
    p = pub["p"]
    q0, q1, q2, q3 = pub["q0"], pub["q1"], pub["q2"], pub["q3"]
    beta, beta2 = pub["beta"], pub["beta2"]
    x = pub["x"]
    d0, d1 = pub["d0"], pub["d1"]

    def Q(X):
        return (q0 + q1 * X + q2 * X * X + q3 * X * X * X) % p

    def Qe(Y):
        return (q0 + q2 * Y) % p

    def Qo(Y):
        return (q1 + q3 * Y) % p

    def Q1(Y):
        return (Qe(Y) + beta * Qo(Y)) % p

    def Q1c(Y):
        return (Q1(Y) + d0 + d1 * Y) % p

    inv2 = pow(2, p - 2, p)
    xx = x * x % p
    re = (Q(x) + Q((-x) % p)) * inv2 % p
    ro = (Q(x) - Q((-x) % p)) * pow(2 * x, p - 2, p) % p
    c, d = Q1(0), (Q1(1) - Q1(0)) % p

    # The dishonest fold's difference d0 + d1*Y vanishes at exactly one Y, constructed as
    # a square s^2 (see fixtures/generate.py), so its two square roots are the pair of
    # points this line names. p is a small toy prime, so scanning for the roots is exact.
    y_root = (-d0 * pow(d1, p - 2, p)) % p
    roots = sorted(candidate for candidate in range(p) if (candidate * candidate) % p == y_root)

    return {
        "poly": (Q(0), Q(1), Q(2)),
        "fold": (Q1(0), Q1(1), Q1(2)),
        "fold2": (c + beta2 * d) % p,
        "query": (Q(x), Q((-x) % p)),
        "recover": (re, ro, Qe(xx), Qo(xx)),
        "consistency": ((re + beta * ro) % p, Q1(xx)),
        "cheat-caught": ((re + beta * ro) % p, Q1c(xx)),
        "miss-points": (roots[0], roots[1]),
    }


def _line(name):
    def expected(server, seed):
        del server  # not used: the mirror reads public state directly, see module docstring
        import fixtures.generate as fixtures_generate

        value = _values(fixtures_generate.setting(seed)["public"])[name]
        return list(value) if isinstance(value, tuple) else value

    return expected


_LINES = (
    "poly", "fold", "fold2", "query",
    "recover", "consistency", "cheat-caught", "miss-points",
)

EXPECTED = {name: _line(name) for name in _LINES}


def _visible(server, seed):
    """Every number the learner is looking at, labelled as `show.py` labels it.

    The drill's whole point is that the answer is never on screen: the field, the coefficients,
    the challenges, the query point, and the swap's difference are shown, but the folded
    values, the openings, the recovered halves, and the miss points are not. Declaring them all lets the
    probe measure that claim on every seed.
    """
    del server
    import fixtures.generate as fixtures_generate

    return dict(fixtures_generate.setting(seed)["public"])


VISIBLE = {name: _visible for name in _LINES}
