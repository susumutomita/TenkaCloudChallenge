"""Groups, key pairs and share layouts, all derived from the per-deploy FLAG_SEED.

Week 2's other companions all live in a world where the parties can already talk
freely: shares get added locally, and the one hard operation (multiplication) is
bought with a triple somebody prepared in advance. Nothing there explains where the
*preprocessing* could come from, or how two parties who trust each other with
nothing at all can compute anything together in the first place.

Oblivious transfer is the missing primitive. One party holds two messages, the other
picks one, and afterwards:

  * the receiver has exactly the message it chose, and nothing about the other one;
  * the sender does not know which one that was.

The construction here is the standard Diffie-Hellman-flavoured one, in a prime-order
subgroup of Z_p^*:

    sender publishes   A = g^a
    receiver sends     B = g^t          (choice 0)
                       B = A * g^t      (choice 1)
    sender encrypts    m_0 under H(B^a)
                       m_1 under H((B/A)^a)
    receiver decrypts  with H(A^t)

Whichever branch the receiver took, exactly one of the sender's two keys equals
H(A^t) = H(g^(a*t)); recovering the other one would mean solving a discrete log.

## Why `t` is drawn from 0..q-1 and not 1..q-1

Because the receiver's privacy is a statement about a *distribution*, not about any
one message. With t uniform over the whole of 0..q-1, `B` is uniform over the
subgroup under both choices, so the sender sees the same distribution either way and
learns nothing. Exclude 0 -- the way one habitually excludes it for a secret
exponent -- and `B = 1` becomes reachable only when the choice was 1, and `B = A`
only when the choice was 0. Two values out of q now name the choice bit outright.

The parameters are small enough to read and far too small to use: discrete log here
is a few hundred trial multiplications. The point is to make the failure observable,
not to withstand anything.
"""

from __future__ import annotations

import hashlib

#: (p, q, g) with p = 2q + 1 and g of order q. Small, and verified at import time
#: below rather than trusted -- a mistyped generator would silently produce a group
#: where the protocol still "works" on most inputs.
GROUPS = (
    (467, 233, 4),
    (479, 239, 4),
    (503, 251, 4),
    (563, 281, 4),
    (587, 293, 4),
    (719, 359, 4),
    (839, 419, 4),
    (863, 431, 4),
    (887, 443, 4),
    (983, 491, 4),
)

#: The GMW gate this problem builds. `and` is the only one that needs a transfer:
#: XOR is linear over the shares, so each party just XORs its own row.
GATES = ("xor", "and")


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def group(seed: str, label: str = "public") -> dict[str, int]:
    s = _stream(seed, f"group:{label}")
    p, q, g = GROUPS[s[0] % len(GROUPS)]
    return {"p": p, "q": q, "g": g}


def keypair(seed: str, label: str = "public") -> dict[str, int]:
    """The sender's long-term pair. `a` is a secret exponent, so 0 is excluded here."""
    grp = group(seed, label)
    s = _stream(seed, f"key:{label}")
    a = _pick(s, 2, 1, grp["q"] - 1)
    return {"secret": a, "public": pow(grp["g"], a, grp["p"])}


def session(seed: str, label: str) -> dict[str, int]:
    """One transfer: the receiver's choice and blind, and the two messages on offer.

    `blind` may be 0. That is the whole point -- see the module docstring.
    """
    grp = group(seed, label)
    s = _stream(seed, f"session:{label}")
    messages = [
        int.from_bytes(bytes(s[start : start + KEY_BYTES]), "big")
        for start in (8, 8 + KEY_BYTES)
    ]
    return {
        "choice": s[0] & 1,
        "blind": _pick(s, 4, 0, grp["q"] - 1),
        "message_0": messages[0],
        "message_1": messages[1],
    }


def wires(seed: str, label: str) -> dict[str, int]:
    """One AND gate: both parties' shares of x and y, and their two masks.

    x = x0 ^ x1 and y = y0 ^ y1. Nobody holds x or y.
    """
    s = _stream(seed, f"wires:{label}")
    return {
        "x0": s[0] & 1,
        "x1": s[1] & 1,
        "y0": s[2] & 1,
        "y1": s[3] & 1,
        "mask_0": s[4] & 1,
        "mask_1": s[5] & 1,
    }


#: Key and message width, in bytes. Four rather than one on purpose: with a one-byte
#: key the sender's two branch keys collide by chance about once in 256 transfers, and
#: a checker asking "does the other message stay shut" would then fail a correct
#: implementation roughly one seed in thirty. Widening removes that flake instead of
#: teaching the checker to tolerate it.
KEY_BYTES = 4
MESSAGE_MAX = 256**KEY_BYTES - 1


def derive_key(grp: dict[str, int], element: int) -> int:
    """The symmetric key a group element stands for.

    Shared by both sides so a learner is never debugging two different hash
    conventions at once: the exercise is the protocol, not the KDF.
    """
    digest = hashlib.sha256(f"ot-key:{grp['p']}:{element % grp['p']}".encode()).digest()
    return int.from_bytes(digest[:KEY_BYTES], "big")


def health_token(seed: str) -> str:
    grp = group(seed)
    return hashlib.sha256(f"health:{seed}:{grp['p']}".encode()).hexdigest()[:16]


def _verify_groups() -> None:
    for p, q, g in GROUPS:
        if 2 * q + 1 != p:
            raise ValueError(f"{p} is not 2*{q}+1")
        if pow(g, q, p) != 1 or g == 1:
            raise ValueError(f"g={g} does not generate the order-{q} subgroup of Z_{p}^*")


_verify_groups()
