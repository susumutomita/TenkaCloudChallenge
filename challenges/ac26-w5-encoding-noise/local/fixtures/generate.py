"""Parameter sets, messages, and noise samples — all derived from FLAG_SEED.

Nothing here is copied from the course's toy TFHE exercise. The parameters are generated
from the seed and the encoding rule is stated below in full, so a learner who has read
the official material gains no shortcut and a learner who has not loses nothing. Same
seed, same parameters (a session is reproducible); different seed, different parameters
(somebody else's answer does not carry).

The model, completely:

    a message      m   lives in [0, p)
    a scaling      D   spreads the message space across the ciphertext space
    a ciphertext   q = p * D                    <- the encoding rule, not an accident
    encoding       encode(m) = (m * D) mod q
    a noisy value  c = (encode(m) + e) mod q
    decoding       decode(c) = ((c + D // 2) // D) mod p

`decode` is nearest-rounding with a fixed tie rule: a value exactly halfway between two
encoding points rounds **up**. That single choice is what makes the tolerated noise
interval asymmetric when D is even, and the asymmetry is the point of the problem rather
than an artifact worth smoothing away.

None of this is secure. `p`, `q`, and the noise are small enough to enumerate by hand,
which is the only reason the boundary is visible at all. A real parameter set hides the
message behind a lattice problem; this one hides it behind nothing.
"""

from __future__ import annotations

import hashlib

#: Plaintext moduli small enough to enumerate every message by hand.
PRIMES = (2, 3, 4, 5, 7, 8)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 60] * 256 + s[(i + 1) % 60]) % (high - low + 1))


def params(seed: str, label: str = "public") -> dict:
    """One consistent parameter set.

    Both parities of `delta` occur across labels, deliberately. With `delta` even the
    tolerated interval is asymmetric; with it odd the interval is symmetric. An
    implementation that derives the interval from one parity gets the other wrong.
    """
    s = _stream(seed, f"params:{label}")
    p = PRIMES[_pick(s, 0, 0, len(PRIMES) - 1)]
    delta = _pick(s, 4, 6, 33)
    return {"p": p, "delta": delta, "q": p * delta}


def encode(par: dict, m: int) -> int:
    return (m % par["p"]) * par["delta"] % par["q"]


def centered(par: dict, x: int) -> int:
    """The representative of x in [-(q // 2), (q - 1) // 2].

    Same tie convention as `decode`: the half-way point belongs to the upper end, so it
    reduces to the negative side. Two conventions in one problem would be a trap rather
    than a lesson.
    """
    q = par["q"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def decode(par: dict, c: int) -> int:
    delta, p = par["delta"], par["p"]
    return ((c % par["q"]) + delta // 2) // delta % p


def success_interval(par: dict) -> tuple[int, int]:
    """The inclusive noise range over which every message still decodes.

    Not `(-delta // 2, delta // 2)`. The upper end is one short of that when `delta` is
    even, because the exact half-way point rounds up and lands on the next message.
    """
    delta = par["delta"]
    return (-(delta // 2), delta - delta // 2 - 1)


def first_failure(par: dict, m: int, direction: int) -> tuple[int, int]:
    """The first noise in `direction` that decodes to something other than `m`.

    Returned as `(noise, decoded)`. `decoded` wraps modulo p, so the failure for the
    largest message is 0 rather than p, and the failure below 0 is p - 1.
    """
    low, high = success_interval(par)
    noise = high + 1 if direction > 0 else low - 1
    return (noise, decode(par, (encode(par, m) + noise) % par["q"]))


#: Parameter sets that must be rejected, each with the reason. Fixed here rather than
#: written by the learner: rejecting a set you broke yourself proves nothing.
INVALID_PARAMS: tuple[tuple[str, dict], ...] = (
    ("q is not p * delta, so the encoding points do not tile the ring", {"p": 4, "delta": 10, "q": 39}),
    ("p is below 2, so there is no message to distinguish", {"p": 1, "delta": 10, "q": 10}),
    ("delta is below 1, so every message encodes to the same point", {"p": 4, "delta": 0, "q": 0}),
    ("delta is negative", {"p": 4, "delta": -10, "q": -40}),
    ("q is not positive", {"p": 4, "delta": 10, "q": 0}),
)

#: And sets that must be accepted, including the two edge cases most likely to be
#: rejected by an over-eager validator: the smallest usable message space, and delta = 1
#: (a valid, useless parameter set that tolerates no noise at all).
VALID_PARAMS: tuple[dict, ...] = (
    {"p": 2, "delta": 1, "q": 2},
    {"p": 2, "delta": 16, "q": 32},
    {"p": 7, "delta": 9, "q": 63},
)


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(f"health:{seed}:{par['q']}".encode()).hexdigest()[:16]
