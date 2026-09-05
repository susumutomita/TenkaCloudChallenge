"""Optional scratchpad: complete the numbered rows in order.

Paste that row's whole code block over `return None`, then put `return` before
its final expression. Each function supplies names from previous rows. Press
Run public tests to see your own values and paste them into the answer fields.

p is the divisor; % p takes a remainder. w is the two original numbers; r0/r1
hide them. ca/cb are the multipliers for A/B. The prepared numbers a,b,a*b are
split using ra/rb/rc. This is an observer's view of both people, not their
individual private view. See the statement for each person's column.
"""
from __future__ import annotations


def w_shares(p: int, w, r0: int, r1: int):
    """Given setup: w0/w1 each contain one share for person 0 and person 1."""
    return [r0, (w[0]-r0)%p], [r1, (w[1]-r1)%p]


def witness(p: int, w) -> tuple:
    """Row 1: observer's original numbers."""
    return None


def shares(p: int, w, r0: int, r1: int) -> tuple:
    """Row 2: split, then return the two second shares."""
    return None


def reconstruct(p: int, w, r0: int, r1: int) -> tuple:
    """Row 3: observer check, reconstruct both original numbers."""
    w0, w1 = w_shares(p, w, r0, r1)
    return None


def noleak(p: int, w, r0: int) -> list:
    """Row 4: hold one share fixed while changing the original number."""
    return None


def ashares(p: int, w, r0: int, r1: int, ca) -> list:
    """Row 5: each person's local calculation, then return A_sh."""
    w0, w1 = w_shares(p, w, r0, r1)
    return None


def aopen(p: int, w, r0: int, r1: int, ca) -> tuple:
    """Row 6: observer check of the shared and direct results."""
    A_sh = ashares(p, w, r0, r1, ca)
    return None


def bshares(p: int, w, r0: int, r1: int, cb) -> tuple:
    """Row 7: use cb, then return both shares followed by B."""
    w0, w1 = w_shares(p, w, r0, r1)
    return None


def crossmul(p: int, w, r0: int, r1: int, ca, cb) -> tuple:
    """Row 8: compare the incomplete and complete products; they may coincide."""
    A_sh = ashares(p, w, r0, r1, ca)
    B_sh = ashares(p, w, r0, r1, cb)
    A, B = sum(A_sh)%p, sum(B_sh)%p
    return None


def triple(p: int, a: int, b: int, ra: int, rb: int, rc: int) -> tuple:
    """Row 9: observer checks the separately prepared multiplication material."""
    return None


def beaveropen(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> tuple:
    """Row 10: exchange each person's difference shares, then return (d,e)."""
    A_sh = ashares(p, w, r0, r1, ca)
    B_sh = ashares(p, w, r0, r1, cb)
    a_sh, b_sh = [ra, (a-ra)%p], [rb, (b-rb)%p]
    return None


def cshares(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int, rc: int) -> list:
    """Row 11: build z, add d*e only for person 0, reduce again, then return z."""
    d, e = beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb)
    a_sh, b_sh = [ra, (a-ra)%p], [rb, (b-rb)%p]
    c_sh = [rc, (a*b-rc)%p]
    return None


def csum(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int, rc: int) -> int:
    """Row 12: add the completed shares and reduce to get C."""
    z = cshares(p, w, r0, r1, ca, cb, a, b, ra, rb, rc)
    return None


def expand(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> int:
    """Row 13: verify the four-term identity."""
    d, e = beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb)
    return None


def nolink(p: int, w, r0: int, r1: int, ca, cb, a: int, b: int, ra: int, rb: int) -> list:
    """Row 14: candidate A and required a, for someone who only knows d."""
    A = sum(ashares(p, w, r0, r1, ca))%p
    d, e = beaveropen(p, w, r0, r1, ca, cb, a, b, ra, rb)
    return None
