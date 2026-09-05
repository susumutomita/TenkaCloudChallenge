"""Provided arithmetic helpers; no deployment answers or fixture generation."""

def rh(q, n, value):
    """Rescale to 2*n positions; nearest integer, ties to an even integer."""
    return round(value * 2 * n / q)


def table(p, n, shift):
    """Answers in runs around message centres. See the free per-position example."""
    slot=2*n//p
    half=p//2
    values=[]
    for j in range(n):
        message=min((j+slot//2)//slot,half-1)
        values.append((message+shift)%half)
    return values


def read(values, position):
    """One n-position lap flips the sign; two laps return to the same value."""
    n=len(values)
    position=position%(2*n)
    if position<n:
        return values[position]
    return -values[position-n]


def valid_window(public, pair):
    if not isinstance(pair,(list,tuple)) or len(pair)!=2 or any(type(x) is not int for x in pair):return False
    p,q,n,shift=[public[k] for k in ('p','q','n','shift')]
    a,b=pair
    if not (0<=a<q and 0<=b<q):return False
    phase=(b-a)%q
    message,noise=divmod(phase,q//p)
    if not (message<p//2 and 0<noise<(q//p)/2):return False
    separate=(rh(q,n,b)-rh(q,n,a))%(2*n)
    together=rh(q,n,phase)%(2*n)
    values=table(p,n,shift)
    return read(values,separate)!=read(values,together)


def valid_edge(public, values):
    p,n,shift=[public[k] for k in ('p','n','shift')]
    if not isinstance(values,(list,tuple)) or len(values)!=n or any(type(x) is not int or not -(p//2-1)<=x<=p//2-1 for x in values):return False
    slot=2*n//p
    return all(read(values,m*slot+d)==(m+shift)%(p//2) for m in range(p//2) for d in public['offsets'])
