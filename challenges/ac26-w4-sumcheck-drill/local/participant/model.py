"""Public formulas only: interpolation, wiring and bounded-degree messages."""
PAIRS=((0,0),(0,1),(1,0),(1,1))


def layer(p,x):
    y0=(x[0]+x[1])%p
    y1=x[2]*x[3]%p
    return y0,y1,(y0+y1)%p


def line(p,y0,y1,z):
    return (y0*(1-z)+y1*z)%p


def wired(p,y0,y1,a,b):
    return ((1-a)*b*(line(p,y0,y1,a)+line(p,y0,y1,b)))%p


def poly(p,coefficients,t):
    a0,a1,a2=coefficients
    return (a0+a1*t+a2*t*t)%p


def fake_claim(p,first,r1,d):
    return (poly(p,first,r1)+d*(1-r1))%p


def coefficients(p,values):
    return isinstance(values,(list,tuple)) and len(values)==3 and all(type(x) is int and 0<=x<p for x in values)


def blind_spots(p,second,candidate):
    return [t for t in range(p) if poly(p,candidate,t)==poly(p,second,t)]


def valid_spoof(public,candidate):
    p=public['p']
    if not coefficients(p,candidate):return False
    claim=fake_claim(p,public['first'],public['r1'],public['d'])
    return (poly(p,candidate,0)+poly(p,candidate,1))%p==claim and poly(p,candidate,public['r2'])==poly(p,public['second'],public['r2'])


def valid_pair(public,pair):
    p=public['p']
    if not isinstance(pair,(list,tuple)) or len(pair)!=2 or not all(coefficients(p,row) for row in pair):return False
    claim=fake_claim(p,public['first'],public['r1'],public['d'])
    if any((poly(p,row,0)+poly(p,row,1))%p!=claim for row in pair):return False
    left=blind_spots(p,public['second'],pair[0]);right=blind_spots(p,public['second'],pair[1])
    return len(left)==len(right)==2 and not any(t in right for t in left)
