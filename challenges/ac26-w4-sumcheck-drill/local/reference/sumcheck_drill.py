"""Author-only solution to the published arithmetic and construction conditions."""
from participant.model import layer, line, wired, poly

def circuit(p, x):
    """Return (y0,y1,total): add x[0]+x[1], multiply x[2]*x[3], then add both."""
    return layer(p, x)

def mle(p, x):
    """Return the line's values at 0,1,2, using the circuit's two middle values."""
    y0, y1, total = layer(p, x)
    return (line(p, y0, y1, 0), line(p, y0, y1, 1), line(p, y0, y1, 2))

def grid(p, x):
    """Return wired(p,y0,y1,a,b) at (0,0),(0,1),(1,0),(1,1), in order."""
    y0, y1, total = layer(p, x)
    return (wired(p, y0, y1, 0, 0), wired(p, y0, y1, 0, 1), wired(p, y0, y1, 1, 0), wired(p, y0, y1, 1, 1))

def round1(p, first, r1):
    """Return the first message's endpoint sum and its value at r1."""
    endpoints = (poly(p, first, 0) + poly(p, first, 1)) % p
    return (endpoints, poly(p, first, r1))

def final_check(p, x, second, r1, r2):
    """Return the second message's endpoint sum, its value at r2, and wired(r1,r2)."""
    y0, y1, total = layer(p, x)
    endpoints = (poly(p, second, 0) + poly(p, second, 1)) % p
    return (endpoints, poly(p, second, r2), wired(p, y0, y1, r1, r2))

def lie(p, first, r1, d):
    """Add d*(1-t) to the first message; return its endpoint sum and value at r1."""
    endpoints = (poly(p, first, 0) + poly(p, first, 1) + d) % p
    claim = (poly(p, first, r1) + d * (1 - r1)) % p
    return (endpoints, claim)

def lie_caught(p,first,second,r1,r2,d):
    from itertools import product
    claim=(poly(p,first,r1)+d*(1-r1))%p
    for candidate in product(range(p),repeat=3):
        if (poly(p,candidate,0)+poly(p,candidate,1))%p==claim and poly(p,candidate,r2)==poly(p,second,r2):
            return candidate
    raise ValueError('No false message exists')


def miss_points(p,first,second,r1,d):
    from itertools import product
    claim=(poly(p,first,r1)+d*(1-r1))%p
    saved=[]
    for candidate in product(range(p),repeat=3):
        if (poly(p,candidate,0)+poly(p,candidate,1))%p!=claim:continue
        matches=[t for t in range(p) if poly(p,candidate,t)==poly(p,second,t)]
        if len(matches)!=2:continue
        for previous,previous_matches in saved:
            if all(t not in previous_matches for t in matches):return (previous,candidate)
        saved.append((candidate,matches))
    raise ValueError('No disjoint false-message pair exists')
