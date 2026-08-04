"""Mirror for ac26-w1-underconstraint's `root-cause` object."""


def _root_cause(server, seed):
    return {
        "missingConstraintId": server.dropped_constraint(seed),
        "manipulatedSignals": server._manipulated_signals(),
    }


EXPECTED = {"root-cause": _root_cause}
