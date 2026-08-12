"""Groups, secrets, message bits and masks, all derived from the per-deploy FLAG_SEED.

1-out-of-2 OT over a prime-order subgroup, and a GMW-style secret AND built from two
of them. The group is deliberately a toy -- small enough that every value can be
checked on paper -- because what the checkpoints grade is not the arithmetic but the
two promises the protocol keeps: the sender never learns the choice, and the receiver
opens only the branch it chose. Both promises are properties of *where the randomness
comes from*, which is why everything here is derived from the seed and nothing is a
constant a learner could memorize.
"""

from __future__ import annotations

import hashlib

#: Safe-prime toy groups (p = 2q + 1, q prime, g of order q). The first triple is the
#: classroom group every walkthrough of the protocol uses; the others exist so that
#: hidden labels and unseen seeds are not all the same handful of numbers.
GROUPS: tuple[tuple[int, int, int], ...] = (
    (23, 11, 2),
    (47, 23, 2),
    (59, 29, 3),
    (83, 41, 4),
    (107, 53, 4),
)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def group(seed: str, label: str = "public") -> tuple[int, int, int]:
    """(p, q, g) for one case.

    The `public` label always gets the classroom group (p=23, q=11, g=2), so the
    numbers a learner reasons about on paper match what the statement walks through;
    hidden labels draw from the whole table.
    """
    if label == "public":
        return GROUPS[0]
    s = _stream(seed, f"group:{label}")
    return GROUPS[s[0] % len(GROUPS)]


def ot_setting(seed: str, label: str = "public") -> dict[str, int]:
    """One OT session.

    The sender secret `a` is never 0: A = g^0 = 1 would collapse the two branch keys
    into one. The receiver secret `b` ranges over 0..q-1 *including 0*, and the 0 is
    load-bearing -- dropping it is exactly the defect the `choice-leak` checkpoint is
    about. The two messages are distinct 32-bit values so that "the wrong branch did
    not open" is checkable rather than a coin flip.
    """
    p, q, g = group(seed, label)
    s = _stream(seed, f"ot:{label}")
    a = _pick(s, 0, 1, q - 1)
    b = _pick(s, 2, 0, q - 1)
    choice = s[4] & 1
    m0 = int.from_bytes(bytes(s[8:12]), "big")
    m1 = int.from_bytes(bytes(s[12:16]), "big")
    if m1 == m0:
        m1 = (m1 + 1) % (1 << 32)
    return {"p": p, "q": q, "g": g, "a": a, "b": b, "choice": choice, "m0": m0, "m1": m1}


def gmw_setting(seed: str, label: str = "public") -> dict[str, int]:
    """One GMW AND instance: the four share bits, the two masks, and the secrets of
    the two OT sessions that carry the cross terms."""
    p, q, g = group(seed, label)
    s = _stream(seed, f"gmw:{label}")
    return {
        "p": p,
        "q": q,
        "g": g,
        "x0": s[0] & 1,
        "x1": s[1] & 1,
        "y0": s[2] & 1,
        "y1": s[3] & 1,
        "mask0": s[4] & 1,
        "mask1": s[5] & 1,
        "a01": _pick(s, 8, 1, q - 1),
        "b01": _pick(s, 10, 0, q - 1),
        "a10": _pick(s, 12, 1, q - 1),
        "b10": _pick(s, 14, 0, q - 1),
    }


def audit_bits(seed: str) -> dict[str, int]:
    """The recorded run the `cross-term-audit` checkpoint asks about: the four share
    bits a broken (OT-skipping) implementation was run on in this deployment."""
    s = _stream(seed, "audit")
    return {"x0": s[0] & 1, "x1": s[1] & 1, "y0": s[2] & 1, "y1": s[3] & 1}


def health_token(seed: str) -> str:
    cfg = ot_setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['a']}:{cfg['b']}".encode()).hexdigest()[:16]
