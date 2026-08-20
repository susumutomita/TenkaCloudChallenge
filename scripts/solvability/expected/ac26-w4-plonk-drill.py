"""Mirror for ac26-w4-plonk-drill's eight direct-answer lines.

Every checkpoint is the value one line of Python prints against this deployment's numbers,
so the mirror is the deployment's `expected` table itself — one exact value per line per
seed. Tuples are mirrored as lists, the form the Portal's JSON decoding produces. Twelve
lines are typed; the eight graded ones are the platform's per-problem maximum.
"""


def _line(name):
    def expected(server, seed):
        value = server.setting(seed)["expected"][name]
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
    return dict(server.setting(seed)["public"])


VISIBLE = {name: _visible for name in _LINES}
