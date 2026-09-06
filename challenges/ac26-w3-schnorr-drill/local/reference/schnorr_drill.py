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
    return (-t) % p


def field_inv(t: int, p: int) -> int:
    """Field 1 — the partner of t that multiplies to 1 (mod p)."""
    return pow(t, p - 2, p)


def lambda_chord(G: tuple, Q: tuple, p: int) -> int:
    """Helper for field 2 — the slope of the line through G and Q (mod p)."""
    Gx, Gy = G
    Qx, Qy = Q
    return ((Qy - Gy) * pow(Qx - Gx, p - 2, p)) % p


def add_points(G: tuple, Q: tuple, p: int) -> tuple:
    """Field 2 — G + Q: the third intersection, reflected. Returns (x3, y3)."""
    Gx, Gy = G
    Qx, Qy = Q
    lam = lambda_chord(G, Q, p)
    x3 = (lam * lam - Gx - Qx) % p
    y3 = (lam * (Gx - x3) - Gy) % p
    return (x3, y3)


def double(G: tuple, p: int, a: int) -> tuple:
    """Field 3 — 2G by the tangent. Returns (x3, y3)."""
    Gx, Gy = G
    lam = ((3 * Gx * Gx + a) * pow(2 * Gy, p - 2, p)) % p
    x3 = (lam * lam - 2 * Gx) % p
    y3 = (lam * (Gx - x3) - Gy) % p
    return (x3, y3)


def ec_add(P: tuple | None, Q: tuple | None, p: int, a: int) -> tuple | None:
    """Helper for field 4 — the full addition: None is O, same x with opposite y is O."""
    if P is None:
        return Q
    if Q is None:
        return P
    if P[0] == Q[0] and (P[1] + Q[1]) % p == 0:
        return None
    if P == Q:
        lam = ((3 * P[0] * P[0] + a) * pow(2 * P[1], p - 2, p)) % p
    else:
        lam = ((Q[1] - P[1]) * pow(Q[0] - P[0], p - 2, p)) % p
    x3 = (lam * lam - P[0] - Q[0]) % p
    return (x3, (lam * (P[0] - x3) - P[1]) % p)


def order(G: tuple, p: int, a: int) -> int:
    """Field 4 — how many additions of G reach O."""
    R, k = G, 1
    while R is not None:
        R = ec_add(R, G, p, a)
        k += 1
    return k


def ec_mul(k: int, P: tuple | None, p: int, a: int) -> tuple | None:
    """Helper for fields 5–8 — k copies of P added together."""
    R = None
    for _ in range(k):
        R = ec_add(R, P, p, a)
    return R


def pubkey(x: int, G: tuple, p: int, a: int) -> tuple:
    """Helper for fields 5–6 — P = x*G."""
    return ec_mul(x, G, p, a)


def commit(r: int, G: tuple, p: int, a: int) -> tuple:
    """Helper for fields 5–6 — R = r*G."""
    return ec_mul(r, G, p, a)


def response(r: int, e: int, x: int, n: int) -> int:
    """Field 5 — s = r + e*x, reduced by the order n."""
    return (r + e * x) % n


def verify_left(s: int, G: tuple, p: int, a: int) -> tuple:
    """Field 6 — the left side s*G of the check s*G = R + e*P."""
    return ec_mul(s, G, p, a)


def nonce_reuse(s1: int, s2: int, e1: int, e2: int, n: int) -> int:
    """Field 7 — the secret behind two responses that shared a nonce."""
    return ((s1 - s2) * pow(e1 - e2, n - 2, n)) % n


def transfer(P2: tuple, ef: int, G: tuple, p: int, a: int) -> tuple:
    """Field 8: construct [Rx,Ry,s] for the already visible challenge ef.

    Choose s in 0..n-1. Compute B=ef*P2 and R=s*G+(-B), where -(X,Y)=(X,-Y % p)
    and -None=None. If R is None, try another s; precisely one s is excluded.
    Return (R[0],R[1],s). The public equation is s*G=R+ef*P2.
    This constructs one record after learning ef, not a live proof in normal order.
    """
    n = order(G, p, a)
    B = ec_mul(ef, P2, p, a)
    negB = None if B is None else (B[0], -B[1] % p)
    for s in range(n):
        R = ec_add(ec_mul(s, G, p, a), negB, p, a)
        if R is not None:
            return (R[0], R[1], s)
    raise ValueError("no finite commitment")
