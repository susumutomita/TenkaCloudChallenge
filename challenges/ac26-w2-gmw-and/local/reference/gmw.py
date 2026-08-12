"""Reference solution. Ships inside the image only; kept out of the learner's checkout.

1-out-of-2 OT over a prime-order subgroup, then a GMW-style secret AND that uses it
twice. The conventions (who is sender in which session, which mask goes into which
messages, who cancels what) are pinned by the starter's docstrings; this file follows
them exactly, because the hidden tests check each party's output share against the
view that party actually holds.
"""

from __future__ import annotations

import hashlib


def _pad(key: int, branch: int) -> int:
    """The shared one-time pad for one branch, derived from a group element.

    Both ends must land on the same bytes from the same key, so the derivation is
    fixed: sha256 over a domain label, the branch index, and the key. 32 bits is
    plenty for a toy -- what matters is that guessing it is not cheaper than knowing
    the key.
    """
    digest = hashlib.sha256(f"ot-pad:{branch}:{key}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _require_group_element(value: int, p: int, q: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("group element must be an int")
    if not 1 <= value < p or pow(value, q, p) != 1:
        raise ValueError("value is not an element of the order-q subgroup")


def ot_request(a_pub: int, choice: int, b: int, p: int, q: int, g: int) -> int:
    """The receiver's one message to the sender.

    choice 0 -> g^b, choice 1 -> A * g^b. Because b is uniform over 0..q-1
    (including 0), both expressions range over the entire subgroup, and the request
    says nothing about the choice.
    """
    _require_group_element(a_pub, p, q)
    if not isinstance(choice, int) or choice not in (0, 1):
        raise ValueError("choice must be 0 or 1")
    if not isinstance(b, int) or isinstance(b, bool) or not 0 <= b < q:
        raise ValueError("receiver secret b must be in 0..q-1 (0 included)")
    request = pow(g, b, p)
    if choice == 1:
        request = (a_pub * request) % p
    return request


def ot_encrypt(
    a: int, request: int, m0: int, m1: int, p: int, q: int, g: int
) -> list[int]:
    """The sender's reply: both messages, each under its own branch key.

    K0 = request^a and K1 = (request * A^{-1})^a. Whichever way the request was
    formed, exactly one of these equals A^b -- the one for the branch the receiver
    chose -- and the sender cannot tell which.
    """
    _require_group_element(request, p, q)
    if not isinstance(a, int) or isinstance(a, bool) or not 1 <= a < q:
        raise ValueError("sender secret a must be in 1..q-1")
    a_pub = pow(g, a, p)
    key0 = pow(request, a, p)
    key1 = pow((request * pow(a_pub, p - 2, p)) % p, a, p)
    return [m0 ^ _pad(key0, 0), m1 ^ _pad(key1, 1)]


def ot_decrypt(
    b: int, choice: int, a_pub: int, ciphertexts: list[int], p: int, q: int, g: int
) -> int:
    """The receiver opens the branch it chose, with the one key it can compute: A^b."""
    key = pow(a_pub, b, p)
    return ciphertexts[choice] ^ _pad(key, choice)


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
    """A secret AND on XOR shares, carried by exactly two OTs.

    Session 01: P0 is the sender with messages (mask0 ^ x0*0, mask0 ^ x0*1) and
    secret a01; P1 chooses with y1 and secret b01, receiving t01 = mask0 ^ (x0 & y1).
    Session 10 is symmetric: P1 sends with mask1 and a10, P0 chooses with y0 and
    b10, receiving t10 = mask1 ^ (x1 & y0).

    Each party's output share is built only from its own view:
      z0 = (x0 & y0) ^ mask0 ^ t10      (P0 cancels the mask *it* injected)
      z1 = (x1 & y1) ^ mask1 ^ t01
    """
    # Session 01: P0 -> P1, carrying x0 & y1 under mask0.
    a01_pub = pow(g, a01, p)
    request01 = ot_request(a01_pub, y1, b01, p, q, g)
    cts01 = ot_encrypt(a01, request01, mask0 ^ (x0 & 0), mask0 ^ (x0 & 1), p, q, g)
    t01 = ot_decrypt(b01, y1, a01_pub, cts01, p, q, g)

    # Session 10: P1 -> P0, carrying x1 & y0 under mask1.
    a10_pub = pow(g, a10, p)
    request10 = ot_request(a10_pub, y0, b10, p, q, g)
    cts10 = ot_encrypt(a10, request10, mask1 ^ (x1 & 0), mask1 ^ (x1 & 1), p, q, g)
    t10 = ot_decrypt(b10, y0, a10_pub, cts10, p, q, g)

    z0 = (x0 & y0) ^ mask0 ^ t10
    z1 = (x1 & y1) ^ mask1 ^ t01
    return (z0, z1)
