"""Scratchpad for the fourteen lines — optional, for when you cannot open Python.

The drill is meant to be typed into your own `python3`, one line at a time, after pasting
the numbers from "Inspect evidence". If you cannot open Python, fill in these functions in the
Portal editor instead and press "Run public tests": the test prints what YOUR
functions return on THIS deployment's numbers — exactly what the REPL would have printed.
Paste those values into the answer fields. Each answer field is a single-line input.

Each function is one drill line, with the line's names replaced by parameters. p is the
field modulus, w = (w0, w1) the two-wire witness, r0/r1 each wire's own share randomness,
ca/cb the public coefficient vectors of the two linear forms A = ca . w and B = cb . w,
a/b the Beaver triple's two random factors, and ra/rb/rc the triple's own share
randomness (one per factor: a, b, and c = a * b).
"""

from __future__ import annotations


def w_shares(p: int, w, r0: int, r1: int):
    """Helper for lines 2-14 — each wire's two-party share vector: [r_i, (w[i] - r_i) % p]."""
    return [r0 % p, (w[0] - r0) % p], [r1 % p, (w[1] - r1) % p]


def witness(p: int, w) -> tuple:
    """Line 1 — (p, w): the field and the secret about to be split. Nobody keeps it whole."""
    return (p, tuple(w))


def shares(p: int, w, r0: int, r1: int) -> tuple:
    """Line 2 — (w0[1], w1[1]): the second, newly-revealed entry of each wire's share."""
    w0, w1 = w_shares(p, w, r0, r1)
    return (w0[1], w1[1])


def reconstruct(p: int, w, r0: int, r1: int) -> tuple:
    """Line 3 — add every party's shares back: this must equal the witness on screen."""
    w0, w1 = w_shares(p, w, r0, r1)
    return (sum(w0) % p, sum(w1) % p)


def noleak(p: int, w, r0: int) -> list:
    """Line 4 — hold r0 fixed, vary the secret: the first party's share never moves."""
    return [(r0 % p, (s - r0) % p) for s in (w[0], p // 2, p - 1)]


def ashares(p: int, w, r0: int, r1: int, ca) -> list:
    """Line 5 — A's shares: ca[0]*w0[i] + ca[1]*w1[i] for each party i. No communication."""
    w0, w1 = w_shares(p, w, r0, r1)
    return [(ca[0] * x + ca[1] * y) % p for x, y in zip(w0, w1)]


def aopen(p: int, w, r0: int, r1: int, ca) -> tuple:
    """Line 6 — (A opened, A computed directly from w): the two must agree."""
    a_sh = ashares(p, w, r0, r1, ca)
    return (sum(a_sh) % p, (ca[0] * w[0] + ca[1] * w[1]) % p)


def bshares(p: int, w, r0: int, r1: int, cb) -> tuple:
    """Line 7 — (B_sh[0], B_sh[1], B): B's shares and B opened, same recipe as lines 5-6."""
    w0, w1 = w_shares(p, w, r0, r1)
    b_sh = [(cb[0] * x + cb[1] * y) % p for x, y in zip(w0, w1)]
    return (b_sh[0], b_sh[1], sum(b_sh) % p)


def crossmul(p: int, w, r0: int, r1: int, ca, cb) -> tuple:
    """Line 8 — (share-wise product, the correct A*B): these do NOT agree."""
    a_sh = ashares(p, w, r0, r1, ca)
    b_sh0, b_sh1, B = bshares(p, w, r0, r1, cb)
    b_sh = [b_sh0, b_sh1]
    A = sum(a_sh) % p
    naive = sum(x * y for x, y in zip(a_sh, b_sh)) % p
    return (naive, (A * B) % p)


def triple(p: int, a: int, b: int, ra: int, rb: int, rc: int) -> tuple:
    """Line 9 — (a opened, b opened, c opened, a*b): confirms the triple satisfies c = a*b."""
    a_sh = [ra % p, (a - ra) % p]
    b_sh = [rb % p, (b - rb) % p]
    c = (a * b) % p
    c_sh = [rc % p, (c - rc) % p]
    return (sum(a_sh) % p, sum(b_sh) % p, sum(c_sh) % p, (a * b) % p)


def beaveropen(
    p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int
) -> tuple:
    """Line 10 — (d, e) = (A - a, B - b) opened: the only round of communication."""
    A = aopen(p, w, r0, r1, ca)[0]
    B = bshares(p, w, r0, r1, cb)[2]
    a_sh = [ra % p, (a - ra) % p]
    b_sh = [rb % p, (b - rb) % p]
    d = (A - sum(a_sh)) % p
    e = (B - sum(b_sh)) % p
    return (d, e)


def cshares(
    p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int, rc: int
) -> list:
    """Line 11 — each party's share of C, built from d, e and their own triple shares."""
    d, e = beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb)
    a_sh = [ra % p, (a - ra) % p]
    b_sh = [rb % p, (b - rb) % p]
    c = (a * b) % p
    c_sh = [rc % p, (c - rc) % p]
    z = [(c_sh[i] + d * b_sh[i] + e * a_sh[i]) % p for i in range(2)]
    z[0] = (z[0] + d * e) % p
    return z


def csum(
    p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int, rc: int
) -> int:
    """Line 12 — C = the sum of the shares from line 11, opened."""
    z = cshares(p, w, r0, r1, ca, cb, a, b, ra, rb, rc)
    return sum(z) % p


def expand(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> int:
    """Line 13 — the textbook identity d*e + d*b + e*a + a*b, which must also equal C."""
    d, e = beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb)
    return (d * e + d * b + e * a + a * b) % p


def nolink(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> list:
    """Line 14 — for three candidate values of A, the 'a' that would make d match."""
    A = aopen(p, w, r0, r1, ca)[0]
    d, _ = beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb)
    return [(cand, (cand - d) % p) for cand in (A, (A + p // 3) % p, (A + 2 * (p // 3)) % p)]
