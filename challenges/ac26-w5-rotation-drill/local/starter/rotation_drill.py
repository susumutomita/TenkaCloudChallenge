"""Six teaching rows and two construction tasks.

Use the provided rh/table/read helpers below. In rows 1-6 replace return None with
that row's whole code block; return its final expression. Rows 7-8 have published
rules and small examples, but you construct the answer yourself. Public tests show
what your functions return on your own numbers. The new table is a list of n numbers.
"""
from participant.model import rh,table,read


def params(p,q,n):
    """Return p,q,n and q//p, the spacing between encoded messages."""
    return None


def phase(q,s,a,b):
    """Subtract matching a*s products from b, then take the remainder by q."""
    return None


def testpoly(p,n,shift):
    """Return the whole answer table produced by table(p,n,shift)."""
    return None


def rescale(p,q,n,a,b):
    """Return rh(q,n,x) for x=q//p,a[0],b. Halfway ties go to the even integer."""
    return None


def index(q,n,s,a,b):
    """Round b and each a separately, subtract matching rounded a*s, remainder by 2*n."""
    return None


def readout(p,q,n,s,a,b,shift):
    """Read table(p,n,shift) at the position produced by index(q,n,s,a,b)."""
    return None


def window(p,q,n,shift):
    """Construct [new_a,new_b], both 0..q-1.

    The new mask has new_a only at the first key entry equal to 1; others are 0.
    phase=(new_b-new_a)%q; (message,noise)=divmod(phase,q//p).
    Require message<p//2 and 0<noise<(q//p)/2. Using the provided table,
    reading at (rh(q,n,new_b)-rh(q,n,new_a))%(2*n) must differ from
    reading at rh(q,n,phase)%(2*n). Any such pair is accepted.
    """
    return None


def edge(p,n,shift,offsets):
    """Construct n integers between -(p//2-1) and p//2-1.

    For every message=0..p//2-1 and every given offset, read your table at
    message*(2*n//p)+offset. It must equal (message+shift)%(p//2).
    The read helper flips sign after n positions, including negative positions.
    Any table meeting every condition is accepted. This row uses your NEW table.
    """
    return None
