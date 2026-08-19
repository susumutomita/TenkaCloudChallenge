"""Mirror for ac26-w3-schnorr-drill's eight direct-answer lines.

Every checkpoint is the value one line of Python prints against this deployment's numbers,
so the mirror is the deployment's `expected` table itself — one exact value per line per
seed. Points are mirrored as `[x, y]`, the form the Portal's JSON decoding produces. Twelve
lines are typed; the eight graded ones are the platform's per-problem maximum.
"""


def _line(name):
    def expected(server, seed):
        value = server.setting(seed)["expected"][name]
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
    pub = server.setting(seed)["public"]
    shown = {}
    for key, value in pub.items():
        shown[key] = list(value) if isinstance(value, tuple) else value
    return shown


VISIBLE = {name: _visible for name in _LINES}
