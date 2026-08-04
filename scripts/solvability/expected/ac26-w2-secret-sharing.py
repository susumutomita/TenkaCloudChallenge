"""Mirror for ac26-w2-secret-sharing's `threshold` object.

The grader wants `n`, any `n-1` shares, and two *different* secrets each completed by the
share that reaches it — the demonstration that `n-1` shares carry no information. Any
such triple is accepted, so the mirror builds the simplest one.
"""


def _threshold(server, seed):
    cfg = server.setting(seed)
    p, n = cfg["p"], cfg["n"]
    partial = [(index + 1) % p for index in range(n - 1)]
    head = sum(partial) % p
    return {
        "sharesNeeded": n,
        "partial": partial,
        "completions": [
            {"secret": secret, "lastShare": (secret - head) % p} for secret in (0, 1)
        ],
    }


EXPECTED = {"threshold": _threshold}


# The answer is an object — a count, n-1 shares, and two completions — and the probe
# compares a declared field against the answer as a whole, so no field could ever match
# it. Declaring the shown `n` and `p` here would read as a measurement while measuring
# nothing. `sharesNeeded` alone *is* the on-screen party count, but the grader accepts it
# only alongside the two completions, which is the part that cannot be copied.
VISIBLE = {"threshold": lambda _server, _seed: {}}
