"""Mirror for ac26-w1-underconstraint's `root-cause` object."""


def _root_cause(server, seed):
    return {
        "missingConstraintId": server.dropped_constraint(seed),
        "manipulatedSignals": server._manipulated_signals(),
    }


EXPECTED = {"root-cause": _root_cause}


# The answer names the dropped constraint and the signals it let move. Both are drawn from
# the circuit the player is shown, so being on screen is the format of the answer. The
# defect here is the two-way choice, which the guessable-answer probe reports.
VISIBLE = {"root-cause": lambda _server, _seed: {}}
