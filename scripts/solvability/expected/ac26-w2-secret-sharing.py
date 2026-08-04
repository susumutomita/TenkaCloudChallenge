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


VISIBLE = {
    "threshold": lambda server, seed: {
        "n": server.setting(seed)["n"],
        "p": server.setting(seed)["p"],
    }
}
