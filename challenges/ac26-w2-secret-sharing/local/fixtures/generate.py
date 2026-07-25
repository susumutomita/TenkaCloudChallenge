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


def reference_shares(seed: str, label: str = "public") -> list[int]:
    cfg = setting(seed, label)
    p, n, secret = cfg["p"], cfg["n"], cfg["secret"]
    head = randomness(seed, label, n - 1, p)
    return [*head, (secret - sum(head)) % p]


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['p']}:{cfg['n']}".encode()).hexdigest()[:16]
