"""Mirror for ac26-w1-constraint-lab. `broken_witness` returns (witness, first broken id)."""

EXPECTED = {"first-broken": lambda server, seed: server.broken_witness(seed)[1]}
