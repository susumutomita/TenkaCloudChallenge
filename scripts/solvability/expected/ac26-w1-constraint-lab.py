"""Mirror for ac26-w1-constraint-lab's first non-zero trace row."""

EXPECTED = {"first-broken": lambda server, seed: server.broken_diagnosis(seed)}


# The answer is one trace row. Its constraint id and residual are values the learner
# computes with their own implementation, so being visible after that computation is the
# format of the exercise rather than a fixture leak.
VISIBLE = {"first-broken": lambda _server, _seed: {}}
