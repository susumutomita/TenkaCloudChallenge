"""Six teaching functions and two false-message constructions.

Replace return None in rows 1-6 with the matching free block and return its final
expression. Helpers layer, line, wired and poly are provided. The closing hints
explain bounded searches, but you write the construction functions yourself.
All sums and products finish with a remainder by p. Coefficients are in 0..p-1.
"""
from participant.model import layer, line, wired, poly


def circuit(p,x):
    """Return (y0,y1,total): add x[0]+x[1], multiply x[2]*x[3], then add both."""
    return None


def mle(p,x):
    """Return the line's values at 0,1,2, using the circuit's two middle values."""
    return None


def grid(p,x):
    """Return wired(p,y0,y1,a,b) at (0,0),(0,1),(1,0),(1,1), in order."""
    return None


def round1(p,first,r1):
    """Return the first message's endpoint sum and its value at r1."""
    return None


def final_check(p,x,second,r1,r2):
    """Return the second message's endpoint sum, its value at r2, and wired(r1,r2)."""
    return None


def lie(p,first,r1,d):
    """Add d*(1-t) to the first message; return its endpoint sum and value at r1."""
    return None


def lie_caught(p,first,second,r1,r2,d):
    """Construct three coefficients [a0,a1,a2], each 0..p-1, for a false second message.
    Required endpoint sum: (poly(p,first,r1)+d*(1-r1))%p.
    At the prematurely revealed r2, your message must equal poly(p,second,r2).
    Any bounded-degree message meeting both conditions is accepted.
    Here the challenge is revealed first and the message is constructed afterward.
    The secure order would fix the message before revealing the challenge.
    """
    return None


def miss_points(p,first,second,r1,d):
    """Construct two lists of three coefficients: [[a0,a1,a2],[b0,b1,b2]].
    Each coefficient is 0..p-1. Both messages have endpoint sum
    (poly(p,first,r1)+d*(1-r1))%p. Across all t=0..p-1, each message must
    agree with the honest second message at exactly two points. The two pairs
    of agreement points must have no point in common. Any satisfying pair is accepted.
    This task does not receive r2: compare fixed messages over every possible point.
    """
    return None
