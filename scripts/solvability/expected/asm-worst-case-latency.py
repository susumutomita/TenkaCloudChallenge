"""Direct-answer mirror for asm-worst-case-latency.

The problem has exactly one direct-answer checkpoint. The other four are graded
by building and running the submission, which this audit cannot drive in-process
for an assembly reference — see the baseline entry for what covers those instead.
"""


EXPECTED = {
    "environment": lambda server, seed: server.health_token(seed),
}


VISIBLE = {
    "environment": lambda server, seed: {"healthToken": server.health_token(seed)},
}
