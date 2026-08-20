"""Mirror for ac26-w4-sumcheck-drill's eight direct-answer lines.

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
    return dict(server.setting(seed)["public"])


VISIBLE = {name: _visible for name in _LINES}
