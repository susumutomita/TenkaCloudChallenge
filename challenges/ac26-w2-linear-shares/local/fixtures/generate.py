"""Settings and share sets for linear operations, all from the per-deploy FLAG_SEED.

Additive shares have a property that makes MPC practical at all: some operations can
be done by every party independently, on their own share, with nobody talking to
anybody. Addition of two shared values, and scaling by a public constant, are like
that. Adding a public constant is *nearly* like that, and the near-miss is the whole
problem -- it is the one linear operation where "do the same thing to every share"
is wrong.
"""

from __future__ import annotations

import hashlib

PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)

# The four operations the learner is asked to classify by communication cost.
OPERATIONS = ("add-shared", "add-constant", "mul-constant", "mul-shared")


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
    return {
        "p": p,
        "n": _pick(s, 2, 2, 6),
        "x": _pick(s, 4, 0, p - 1),
        "y": _pick(s, 6, 0, p - 1),
        "c": _pick(s, 8, 1, p - 1),
    }


def shares_of(seed: str, label: str, secret: int, n: int, p: int) -> list[int]:
    s = _stream(seed, f"shares:{label}")
    head = [_pick(s, (i * 2) % 90, 0, p - 1) for i in range(n - 1)]
    return [*head, (secret - sum(head)) % p]


def reconstruct(shares: list[int], p: int) -> int:
    return sum(shares) % p


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['p']}:{cfg['n']}".encode()).hexdigest()[:16]
