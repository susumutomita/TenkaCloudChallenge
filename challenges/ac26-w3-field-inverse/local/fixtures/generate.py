"""Primes, composites, and the element sets the hidden tests exercise, from FLAG_SEED.

Two families of modulus, and the difference between them is the point:

  * a **prime** modulus makes every non-zero element invertible, so `F_p` is a field;
  * a **composite** modulus does not. Any element sharing a factor with the modulus has
    no inverse at all, and the extended Euclidean algorithm says so by returning a gcd
    that is not 1 -- which an implementation that computes inverses by Fermat's little
    theorem never notices, because `pow(a, n-2, n)` returns *something* regardless.

Toy sizes: three-digit primes, small enough that a learner can check any inverse by hand
and large enough that guessing is not a strategy. Not a cryptographic parameter set.
"""

from __future__ import annotations

import hashlib

PRIMES = (101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179)
# Composites with small prime factors, so a non-invertible element is easy to construct
# and easy to check.
COMPOSITES = (91, 95, 111, 115, 119, 121, 123, 129, 133, 141, 143, 145)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 128:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 120] * 256 + s[(i + 1) % 120]) % (high - low + 1))


def prime_modulus(seed: str, label: str = "public") -> int:
    return PRIMES[_stream(seed, f"prime:{label}")[0] % len(PRIMES)]


def composite_modulus(seed: str, label: str = "public") -> int:
    return COMPOSITES[_stream(seed, f"composite:{label}")[0] % len(COMPOSITES)]


def sample_values(seed: str, label: str, modulus: int, count: int = 12) -> list[int]:
    """A spread of raw integers, deliberately including the awkward ones.

    Negative values and values past the modulus are in here on purpose: "integer" and
    "field element" are different things, and normalization is where that difference
    first shows up.
    """
    s = _stream(seed, f"values:{label}")
    generated = [_pick(s, 2 * i, -3 * modulus, 3 * modulus) for i in range(count)]
    return [0, 1, modulus, modulus - 1, -1, -modulus, *generated]


def non_invertible(seed: str, modulus: int) -> int:
    """A non-zero element of Z_n with no inverse, for a composite n.

    Returns the smallest such element, so the counterexample a learner submits can be
    checked against a definite answer rather than a set.
    """
    for candidate in range(2, modulus):
        if _gcd(candidate, modulus) != 1:
            return candidate
    raise ValueError(f"{modulus} has no non-invertible non-zero element; it is prime")


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a


def egcd(a: int, b: int) -> tuple[int, int, int]:
    """(g, s, t) with a*s + b*t == g == gcd(a, b). The trace the learner reproduces."""
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
    return old_r, old_s, old_t


def egcd_rows(a: int, b: int) -> list[dict[str, int]]:
    """The full step sequence. Floor division makes it deterministic, so a learner's
    trace must match it row for row -- which is what stops a one-row table that happens
    to satisfy Bezout from passing as a trace."""
    rows: list[dict[str, int]] = []
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t
        rows.append({"q": q, "r": old_r, "s": old_s, "t": old_t})
    return rows


def health_token(seed: str) -> str:
    return hashlib.sha256(
        f"health:{seed}:{prime_modulus(seed)}:{composite_modulus(seed)}".encode()
    ).hexdigest()[:16]
