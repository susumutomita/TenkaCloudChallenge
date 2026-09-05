"""Author-only solution; never shipped to learners."""
from participant.model import rh, table, read


def params(p,q,n):
    return p,q,n,q//p


def phase(q,s,a,b):
    return (b-sum(x*y for x,y in zip(a,s)))%q


def testpoly(p,n,shift):
    return table(p,n,shift)


def rescale(p,q,n,a,b):
    return rh(q,n,q//p),rh(q,n,a[0]),rh(q,n,b)


def index(q,n,s,a,b):
    return (rh(q,n,b)-sum(rh(q,n,x)*y for x,y in zip(a,s)))%(2*n)


def readout(p,q,n,s,a,b,shift):
    return read(table(p,n,shift),index(q,n,s,a,b))


def window(p,q,n,shift):
    values=table(p,n,shift)
    for a in range(q):
        for b in range(q):
            ph=(b-a)%q
            message,noise=divmod(ph,q//p)
            if message>=p//2 or not 0<noise<(q//p)/2:
                continue
            separately=(rh(q,n,b)-rh(q,n,a))%(2*n)
            together=rh(q,n,ph)%(2*n)
            if read(values,separately)!=read(values,together):
                return [a,b]
    raise ValueError('no rounding counterexample')


def edge(p,n,shift,offsets):
    values=[0]*n
    for message in range(p//2):
        for delta in offsets:
            position=(message*(2*n//p)+delta)%(2*n)
            answer=(message+shift)%(p//2)
            values[position%n]=answer if position<n else -answer
    return values
