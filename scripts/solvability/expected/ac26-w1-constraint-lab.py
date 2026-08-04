"""Mirror for ac26-w1-constraint-lab. `broken_witness` returns (witness, first broken id)."""

EXPECTED = {"first-broken": lambda server, seed: server.broken_witness(seed)[1]}


# The answer is a constraint id, and the ids are printed because the player has to name
# one of them — being on screen is the format of the answer, not a leak. What makes this
# checkpoint weak is that only two of the ids are ever correct, which the guessable-answer
# probe reports.
VISIBLE = {"first-broken": lambda _server, _seed: {}}
