"""Settings, sharings and Beaver triples, all derived from the per-deploy FLAG_SEED.

Multiplying two *shared* values is the one operation that cannot be done locally.
Beaver's trick moves the hard part into preprocessing: a triple (a, b, c) with
c = a*b, shared out in advance and independent of the actual inputs, turns one
multiplication into masking, one opening, and a linear combination.

    d = x - a      e = y - b        (local)
    open d, open e                  (one round)
    x*y = c + d*b + e*a + d*e       (linear, given public d and e)

The last term is a public constant, so exactly one party folds it in -- the same
rule as adding a public constant in ac26-w2-linear-shares, arriving in the middle
of a protocol where it is much easier to miss.
"""

from __future__ import annotations

import hashlib

PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)
OPERATIONS = ("mask", "open", "combine", "beaver-multiply")


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
    s = _stream(seed, f"setting:{label}")
    p = PRIMES[s[0] % len(PRIMES)]
    x = _pick(s, 4, 0, p - 1)
    y = _pick(s, 6, 0, p - 1)
    a = _pick(s, 10, 0, p - 1)
    b = _pick(s, 12, 0, p - 1)
    # d = x - a and e = y - b are both forced non-zero. If either vanished, so would
    # d*e, and folding the public product into every share would be indistinguishable
    # from folding it into exactly one -- the wrong answer would grade as correct.
    # A real protocol draws a uniform mask and tolerates d == 0; these parameters are
    # chosen for observability, not for realism, and are far too small for any real use.
    if a == x:
        a = (a + 1) % p
    if b == y:
        b = (b + 1) % p
    return {
        "p": p,
        "n": _pick(s, 2, 2, 5),
        "x": x,
        "y": y,
        "a": a,
        "b": b,
        "c": (a * b) % p,
    }


def shares_of(seed: str, label: str, secret: int, n: int, p: int) -> list[int]:
    s = _stream(seed, f"shares:{label}")
    head = [_pick(s, (i * 2) % 90, 0, p - 1) for i in range(n - 1)]
    return [*head, (secret - sum(head)) % p]


def reconstruct(shares: list[int], p: int) -> int:
    return sum(shares) % p


def triple_shares(seed: str, label: str) -> dict[str, list[int]]:
    """The preprocessed triple, already shared out. Nobody holds a, b or c in the clear."""
    cfg = setting(seed, label)
    n, p = cfg["n"], cfg["p"]
    return {
        "a": shares_of(seed, f"{label}-a", cfg["a"], n, p),
        "b": shares_of(seed, f"{label}-b", cfg["b"], n, p),
        "c": shares_of(seed, f"{label}-c", cfg["c"], n, p),
    }


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['p']}:{cfg['n']}".encode()).hexdigest()[:16]
