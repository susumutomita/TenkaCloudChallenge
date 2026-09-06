"""Deterministic classroom groups, key pairs and share layouts for one deployment.

The OT equations are tested as a small model. The sender exponent is nonzero;
receiver blinds cover a full cycle including exponent residue zero. Uniformity is a
model for the enumerated privacy checks, not a claim that seed-derived sample data
is cryptographic randomness. Tiny-group discrete logarithms are easy to enumerate.
Public test inputs include both roles; private fixtures stay in the verifier image.
"""

from __future__ import annotations

import hashlib

from participant.ot import (  # noqa: F401 - re-exported for the hidden suite and mutation
    KEY_BYTES,
    MESSAGE_MAX,
    derive_key,
)

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


def health_token(seed: str) -> str:
    grp = group(seed)
    return hashlib.sha256(f"health:{seed}:{grp['p']}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Values, not functions.

    Issue 543 option B2: `show.py` and `tests/public/test_oblivious.py` used to import
    this module directly. They read this instead, over the Compose-internal network,
    because the module itself no longer ships in the participant image.

    Every value here is under the `public` label. The hidden suite grades against
    `h0`..`h3` (see tests/hidden/check_oblivious.py) and `unseen` runs under a seed
    derived from a suffix a participant is never served, so nothing below names any
    graded setting.

    `senderKey.secret` is served, and that is not a leak of the receiver's-eye framing
    `show.py` prints. A learner implements both roles here: `encrypt` is the sender's
    step and takes the sender's exponent as an argument, so the public tests cannot call
    it without one. It stays out of `show.py`'s output for the same reason it always
    has -- the receiver is the role the transfer's privacy claim is about -- and holding
    it advances no checkpoint, because every graded call is handed its own parameters.
    """
    grp = group(seed)
    key = keypair(seed)
    ses = session(seed, "public")
    return {
        "group": grp,
        "senderKey": key,
        "session": ses,
        "wires": wires(seed, "public"),
        "healthToken": health_token(seed),
    }


def _verify_groups() -> None:
    for p, q, g in GROUPS:
        if 2 * q + 1 != p:
            raise ValueError(f"{p} is not 2*{q}+1")
        if pow(g, q, p) != 1 or g == 1:
            raise ValueError(f"g={g} does not generate the order-{q} subgroup of Z_{p}^*")


_verify_groups()
