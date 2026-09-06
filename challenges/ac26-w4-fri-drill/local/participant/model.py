"""Given formulas used by the optional scratchpad; no deployment answers."""

def q(qs, X, p):
    q0,q1,q2,q3=qs
    return (q0+q1*X+q2*X**2+q3*X**3)%p


def even(qs, Y, p):
    return (qs[0]+qs[2]*Y)%p


def odd(qs, Y, p):
    return (qs[1]+qs[3]*Y)%p


def folded(qs, beta, Y, p):
    return (even(qs,Y,p)+beta*odd(qs,Y,p))%p


def inverse(a,p):
    """Find the multiplier whose product with a leaves remainder 1."""
    for i in range(1,p):
        if a*i%p==1:
            return i
    raise ValueError('this divisor has no inverse')
