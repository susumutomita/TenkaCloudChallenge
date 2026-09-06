"""Optional calculation scratchpad. Paper answers may leave this file unchanged.

A point is (horizontal, vertical); O, the zero for point addition, is None.
All coordinate operations use division remainders by prime p (Python % p).
The order n counts additions of G until O; response counts use % n instead.
The statement gives the point formulas and one-digit examples. Public tests check
those examples, then print YOUR calculated values for this instance. Submit those
values in the Portal fields to earn points; the file itself is not graded.
"""

from __future__ import annotations


def field_neg(t: int, p: int) -> int:
    """Helper for field 1 — the negative of t, brought into 0..p-1."""
    return None


def field_inv(t: int, p: int) -> int:
    """Field 1 — the partner of t that multiplies to 1 (mod p)."""
    return None


def lambda_chord(G: tuple, Q: tuple, p: int) -> int:
    """Helper for field 2 — the slope of the line through G and Q (mod p)."""
    return None


def add_points(G: tuple, Q: tuple, p: int) -> tuple:
    """Field 2 — G + Q: the third intersection, reflected. Returns (x3, y3)."""
    return None


def double(G: tuple, p: int, a: int) -> tuple:
    """Field 3 — 2G by the tangent. Returns (x3, y3)."""
    return None


def ec_add(P: tuple | None, Q: tuple | None, p: int, a: int) -> tuple | None:
    """Helper for field 4 — the full addition: None is O, same x with opposite y is O."""
    return None


def order(G: tuple, p: int, a: int) -> int:
    """Field 4 — how many additions of G reach O."""
    return None


def ec_mul(k: int, P: tuple | None, p: int, a: int) -> tuple | None:
    """Helper for fields 5–8 — k copies of P added together."""
    return None


def pubkey(x: int, G: tuple, p: int, a: int) -> tuple:
    """Helper for fields 5–6 — P = x*G."""
    return None


def commit(r: int, G: tuple, p: int, a: int) -> tuple:
    """Helper for fields 5–6 — R = r*G."""
    return None


def response(r: int, e: int, x: int, n: int) -> int:
    """Field 5 — s = r + e*x, reduced by the order n."""
    return None


def verify_left(s: int, G: tuple, p: int, a: int) -> tuple:
    """Field 6 — the left side s*G of the check s*G = R + e*P."""
    return None


def nonce_reuse(s1: int, s2: int, e1: int, e2: int, n: int) -> int:
    """Field 7 — the secret behind two responses that shared a nonce."""
    return None


def transfer(P2: tuple, ef: int, G: tuple, p: int, a: int) -> tuple:
    """Field 8: construct [Rx,Ry,s] for the already visible challenge ef.

    Choose s in 0..n-1. Compute B=ef*P2 and R=s*G+(-B), where -(X,Y)=(X,-Y % p)
    and -None=None. If R is None, try another s; precisely one s is excluded.
    Return (R[0],R[1],s). The public equation is s*G=R+ef*P2.
    This constructs one record after learning ef, not a live proof in normal order.
    """
    return None
