"""Mirror for ac26-w4-fri-drill's eight direct-answer lines.

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
    return dict(server.setting(seed)["public"])


VISIBLE = {name: _visible for name in _LINES}
