"""Parties, moduli and secrets, all derived from the per-deploy FLAG_SEED.

Additive secret sharing over F_p: a secret s is split into n shares that sum to s.
The property that makes it useful is not the arithmetic -- that part is trivial --
but that any n-1 of the shares are *independent of the secret*. That independence is
what the checkpoints make the learner demonstrate rather than assert.
"""

from __future__ import annotations

import hashlib

PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def setting(seed: str, label: str = "public") -> dict[str, int]:
    """Modulus, party count and the secret for one case."""
    s = _stream(seed, f"setting:{label}")
    p = PRIMES[s[0] % len(PRIMES)]
    return {"p": p, "n": _pick(s, 2, 2, 6), "secret": _pick(s, 4, 0, p - 1)}


def randomness(seed: str, label: str, count: int, p: int) -> list[int]:
    """Deterministic 'random' field elements, so a session is reproducible."""
    s = _stream(seed, f"rand:{label}")
    return [_pick(s, (i * 2) % 90, 0, p - 1) for i in range(count)]


def _non_degenerate_randomness(
    seed: str, label: str, count: int, p: int, accepts
) -> list[int]:
    """Retry deterministic draws until the exercise has the property it grades."""
    for attempt in range(256):
        draw_label = label if attempt == 0 else f"{label}:retry-{attempt}"
        values = randomness(seed, draw_label, count, p)
        if accepts(values):
            return values
    raise RuntimeError("could not construct non-degenerate sharing randomness")


def share_randomness(seed: str, label: str, count: int, p: int, secret: int) -> list[int]:
    """A draw whose completed split gives the secret to no single party outright."""

    def is_private_enough(head: list[int]) -> bool:
        shares = [*(value % p for value in head), (secret - sum(head)) % p]
        return sum(value != 0 for value in shares) >= 2

    return _non_degenerate_randomness(seed, label, count, p, is_private_enough)


def rerandomization_randomness(seed: str, label: str, count: int, p: int) -> list[int]:
    """A draw whose zero-sharing changes at least one share."""
    return _non_degenerate_randomness(
        seed,
        label,
        count,
        p,
        lambda values: any(value % p != 0 for value in values),
    )


def reference_shares(seed: str, label: str = "public") -> list[int]:
    cfg = setting(seed, label)
    p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
    head = share_randomness(seed, label, n - 1, p, secret)
    return [*head, (secret - sum(head)) % p]


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['p']}:{cfg['n']}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Carries values, not functions.

    The single source `show.py`, `verifier/server.py`'s `GET /public` and
    `tests/public/test_sharing.py` all build their view from. Every field below is
    something `make inspect` already printed or the public tests already imported before
    Issue 543 option B2, so the split changes where a participant reads it, not what they
    may see.

    What is deliberately absent is this module itself. `reference_shares` above builds a
    correct split -- the `share` half of the `share-and-reconstruct` checkpoint -- and the
    two `*_randomness` helpers are the retry loops the graded run draws from. Shipping the
    module put all of that, and `tests/hidden/check_sharing.py`'s assertions beside it, in
    the image a learner's own `make build` produced. Serving the derived values keeps
    `make inspect` and the public tests working without shipping the derivation.

    `secret` is here because it always was: `tests/public/test_sharing.py` has to hand a
    secret to `share()` to check the round trip at all, so this value has been reachable
    from the participant surface since the problem was written. It is not worth points --
    `complete_shares` is graded against every element of F_p, not this one -- and `show.py`
    still does not print it, which is what keeps the `hides-the-secret` reasoning intact.
    """
    cfg = setting(seed)
    p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
    return {
        "params": {"p": p, "n": n},
        "secret": secret,
        "healthToken": health_token(seed),
        "shareRandomness": share_randomness(seed, "public", n - 1, p, secret),
        "rerandomizationRandomness": rerandomization_randomness(seed, "rr", n - 1, p),
        # The n-1 shares `show.py` displays. The last one is withheld here as well as
        # there: printing it would hand over the answer to `complete_shares` for this
        # deployment's own secret.
        "partialShares": reference_shares(seed)[:-1],
    }
