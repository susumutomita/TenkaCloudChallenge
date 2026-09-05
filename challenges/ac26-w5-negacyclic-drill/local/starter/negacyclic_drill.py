"""Six teaching functions followed by two constructions.

Replace return None with the corresponding free code block in rows 1-6;
return the last expression. read and rotate are provided helpers. Rows 7-8
supply rules but no completed construction. Public tests print your own results.
"""
from participant.model import read, rotations as rotate


def params(p,n):
    """Return p,2*n,n,(2*n)//p: message slots, cycle length, table length, spacing."""
    return None


def wrap(lo,hi,n):
    """Return (remaining exponent, sign, original exponent) for E=lo+hi.
    Each removal of n flips the sign. An even count restores the positive sign.
    """
    return None


def signs(n,probes):
    """Read the all-ones table at the six given positions, in the given order."""
    return None


def boundary(n):
    """Find the first nonnegative position whose table read is -1."""
    return None


def hazard(n,lo):
    """Return (lo+n,read(n,lo+n)): same table entry, one sign flip later."""
    return None


def rotations(p,n,noise_a,noise_b):
    """Return rotate(p,n,noise_a+noise_b) in order (0,0),(0,1),(1,0),(1,1)."""
    return None


def constants(p,n,dmax,repair_noise):
    """Construct [bit_a,bit_b,total_noise] that makes the original NAND rule fail.
    Both bits are 0 or 1; noise is an integer from dmax+1 through repair_noise.
    Original phase=(1-enc[bit_a]-enc[bit_b])%p, with enc={0:p-1,1:1}.
    Position=((2*n//p)*phase-noise)%(2*n). read(n,position) must differ
    from -1 for inputs (1,1), +1 otherwise. Any satisfying triple is accepted.
    """
    return None


def margin(p,n,repair_noise):
    """Construct [bias,weight_a,weight_b], integers from 0 through p-1.
    Use phase=(bias-weight_a*enc[a]-weight_b*enc[b])%p, enc={0:p-1,1:1}.
    For every input pair and every total noise 0..repair_noise, the signed table
    read at ((2*n//p)*phase-noise)%(2*n) must implement NAND:
    +1,+1,+1,-1 in order (0,0),(0,1),(1,0),(1,1).
    Any triple satisfying all conditions is accepted; checking one noise is insufficient.
    """
    return None
