"""The supplied layer of this problem: the key both sides of a transfer agree on.

This is the half the problem deliberately does not grade. `derive_key` is shared by the
sender and the receiver so that a learner is never debugging two different hash
conventions at once -- the exercise is the protocol, not the KDF -- and the hidden
suite, the reference and the fixture generator all import it from here too, so the
arithmetic a learner builds on and the one they are graded against cannot drift apart.

Issue 537/538 (Issue 543 option B2): this used to live in `fixtures/generate.py`, which
does not ship in the `participant` Docker stage any more (see ../Dockerfile). The
starter imports `derive_key`, so the supplied half had to survive that split as its own
participant module rather than leave with the seed derivation. `fixtures/generate.py`
re-exports the three names below, which is why nothing downstream of it had to change.
"""

from __future__ import annotations

import hashlib

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
