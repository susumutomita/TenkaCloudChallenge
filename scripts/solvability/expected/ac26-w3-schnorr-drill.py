"""Mirror for ac26-w3-schnorr-drill's eight direct-answer lines.

Every checkpoint is the value one line of Python prints against this deployment's numbers,
so the mirror is the deployment's `expected` table itself — one exact value per line per
seed. Points are mirrored as `[x, y]`, the form the Portal's JSON decoding produces. Twelve
lines are typed; the eight graded ones are the platform's per-problem maximum.

The arithmetic below is typed out independently of `verifier/expected.py` (not imported
from it, not from `verifier.server`): this mirror exists to catch a bug the production
checker's own ground truth could carry, and importing that ground truth here would make
the audit's `oracle` check compare the checker to itself (#537 review). Only the *public*
state (`fixtures.generate.setting(seed)["public"]`) is shared with the checker — that is
the deployment's input, not its answer.
"""


def inv(value, p):
    return pow(value % p, p - 2, p)


def ec_add(P, Q, p, a):
    if P is None:
        return Q
    if Q is None:
        return P
    if P[0] == Q[0] and (P[1] + Q[1]) % p == 0:
        return None
    if P == Q:
        lam = ((3 * P[0] * P[0] + a) * inv(2 * P[1], p)) % p
    else:
        lam = ((Q[1] - P[1]) * inv(Q[0] - P[0], p)) % p
    x3 = (lam * lam - P[0] - Q[0]) % p
    return (x3, (lam * (P[0] - x3) - P[1]) % p)


def ec_mul(k, P, p, a):
    R = None
    for _ in range(k):
        R = ec_add(R, P, p, a)
    return R


def order_of(G, p, a):
    R, k = G, 1
    while R is not None:
        R = ec_add(R, G, p, a)
        k += 1
    return k


def _values(pub):
    p, a, G, Q, t = pub["p"], pub["a"], pub["G"], pub["Q"], pub["t"]
    x, r, e = pub["x"], pub["r"], pub["e"]
    n = order_of(G, p, a)
    response = (r + e * x) % n
    e1, s1, e2, s2 = pub["e1"], pub["s1"], pub["e2"], pub["s2"]
    p2, a2, G2 = pub["p2"], pub["a2"], pub["G2"]
    x2, r2, e2p = pub["x2"], pub["r2"], pub["e2p"]
    n2 = order_of(G2, p2, a2)
    return {
        "field-inv": inv(t, p),
        "add-points": ec_add(G, Q, p, a),
        "double": ec_add(G, G, p, a),
        "order": n,
        "response": response,
        "verify": ec_mul(response, G, p, a),
        "nonce-reuse": ((s1 - s2) * inv(e1 - e2, n)) % n,
        "transfer": (r2 + e2p * x2) % n2,
    }


def _line(name):
    def expected(server, seed):
        del server  # not used: the mirror reads public state directly, see module docstring
        import fixtures.generate as fixtures_generate

        pub = fixtures_generate.setting(seed)["public"]
        value = _values(pub)[name]
        return list(value) if isinstance(value, tuple) else value

    return expected


_LINES = (
    "field-inv", "add-points", "double", "order",
    "response", "verify", "nonce-reuse", "transfer",
)

EXPECTED = {name: _line(name) for name in _LINES}


def _visible(server, seed):
    """Every number the learner is looking at, labelled as `show.py` labels it.

    The drill's whole point is that the answer is never on screen: t, p and the points are
    shown, but p − t, the inverse, G + Q, the order, the keys and the responses are not.
    Declaring them all lets the probe measure that claim on every seed.
    """
    del server
    import fixtures.generate as fixtures_generate

    pub = fixtures_generate.setting(seed)["public"]
    shown = {}
    for key, value in pub.items():
        shown[key] = list(value) if isinstance(value, tuple) else value
    return shown


VISIBLE = {name: _visible for name in _LINES}
