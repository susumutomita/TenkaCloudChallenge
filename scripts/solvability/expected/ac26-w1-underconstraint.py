"""Mirror for ac26-w1-underconstraint's `root-cause` object."""


def _root_cause(server, seed):
    return server._expected_root_cause(seed)  # noqa: SLF001 - the mirror deliberately reads the real grader's own ground truth


EXPECTED = {"root-cause": _root_cause}


# The answer names the dropped constraint and the learner's seeded before/after values.
# Those are derived by running the audit and forgery rather than copied from one fixture field.
VISIBLE = {"root-cause": lambda _server, _seed: {}}
