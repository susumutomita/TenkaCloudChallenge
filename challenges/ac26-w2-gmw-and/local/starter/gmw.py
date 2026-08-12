"""The only file you edit.

An AND on XOR shares needs two products that neither party can compute alone, and
1-out-of-2 OT is the tool that carries them. The starter below is a first draft by
someone who trusted the happy path: it moves the right-looking values around, and it
keeps neither of OT's two promises. The checkpoints are about those promises.

Conventions the verifier holds you to (they are also the natural reading):

  * The toy group is a prime-order subgroup: p = 2q + 1 with q prime, generator g of
    order q. Group elements live in 1..p-1 and satisfy v^q = 1 (mod p).
  * Pads are derived as sha256(f"ot-pad:{branch}:{key}") -- first 4 bytes, big-endian.
    Both ends must derive the same pad from the same key, so this is fixed.
  * gmw_and simulates both parties, but each output share may only use values that
    party actually holds. Session 01: P0 sends (mask0 ^ x0*0, mask0 ^ x0*1) with
    secret a01; P1 chooses with y1 and secret b01. Session 10 is symmetric (P1 sends
    with mask1 and a10; P0 chooses with y0 and b10).
"""

from __future__ import annotations

import hashlib


def _pad(key: int, branch: int) -> int:
    """The shared pad for one branch. Fixed derivation -- do not change it."""
    digest = hashlib.sha256(f"ot-pad:{branch}:{key}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def ot_request(a_pub: int, choice: int, b: int, p: int, q: int, g: int) -> int:
    """The receiver's one message to the sender.

    choice 0 -> g^b, choice 1 -> A * g^b, where A is the sender's public value.
    Validate the inputs: A must be an element of the order-q subgroup, choice must
    be 0 or 1, and b must be in 0..q-1 -- **including 0**. Raise ValueError on
    anything else. (Ask yourself what a sender could learn if 0 were excluded.
    The `choice-leak` checkpoint is that question.)

    The starter ignores `choice` entirely and validates nothing.
    """
    return pow(g, b, p)


def ot_encrypt(
    a: int, request: int, m0: int, m1: int, p: int, q: int, g: int
) -> list[int]:
    """The sender's reply: [c0, c1], each message under its own branch key.

    K0 = request^a, and K1 = (request * A^{-1})^a where A = g^a. Exactly one of
    them equals A^b -- the branch the receiver chose -- and the sender cannot tell
    which. Validate: request must be in the subgroup, a in 1..q-1 (ValueError
    otherwise). Pad branch i with _pad(K_i, i).

    The starter puts BOTH messages under the same key. It still round-trips --
    and the receiver can now open the branch it never chose, which is the promise
    this checkpoint exists to check.
    """
    key = pow(request, a, p)
    return [m0 ^ _pad(key, 0), m1 ^ _pad(key, 1)]


def ot_decrypt(
    b: int, choice: int, a_pub: int, ciphertexts: list[int], p: int, q: int, g: int
) -> int:
    """The receiver opens the branch it chose, with the one key it can compute.

    That key is A^b. The starter returns the ciphertext without decrypting it.
    """
    return ciphertexts[choice]


def gmw_and(
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    mask0: int,
    mask1: int,
    a01: int,
    b01: int,
    a10: int,
    b10: int,
    p: int,
    q: int,
    g: int,
) -> tuple[int, int]:
    """Return (z0, z1) with z0 ^ z1 == (x0 ^ x1) & (y0 ^ y1), using exactly two OTs.

    Expand the AND: (x0^x1)(y0^y1) = x0y0 ^ x0y1 ^ x1y0 ^ x1y1. The outer terms are
    local. The cross terms are not -- x0y1 needs P0's x0 and P1's y1 -- and each one
    travels through one OT session (see the module docstring for who sends what).
    Each mask must be cancelled in the output share of the party that injected it.

    The starter skips the OTs and lets each party AND its own shares locally. It is
    correct on some share patterns and wrong on others -- working out which is the
    `cross-term-audit` checkpoint.
    """
    return (x0 & y0, x1 & y1)
