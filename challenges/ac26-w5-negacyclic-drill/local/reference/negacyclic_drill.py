"""Six teaching functions followed by two constructions.

Replace return None with the corresponding free code block in rows 1-6;
return the last expression. read and rotate are provided helpers. Rows 7-8
supply rules but no completed construction. Public tests print your own results.
"""
from participant.model import read, rotations as rotate

def params(p, n):
    return (p, 2 * n, n, 2 * n // p)

def wrap(lo, hi, n):
    E = lo + hi
    sign = 1
    if E // n % 2 == 1:
        sign = -1
    return (E % n, sign, E)

def signs(n, probes):
    values = []
    for position in probes:
        values.append(read(n, position))
    return values

def boundary(n):
    position = 0
    while read(n, position) > 0:
        position += 1
    return position

def hazard(n, lo):
    position = lo + n
    return (position, read(n, position))

def rotations(p, n, noise_a, noise_b):
    noise = noise_a + noise_b
    return rotate(p, n, noise)

def constants(p,n,dmax,repair_noise):
    for a in (0,1):
        for b in (0,1):
            for noise in range(dmax+1,repair_noise+1):
                wanted=-1 if a==b==1 else 1
                if read(n,rotate(p,n,noise)[2*a+b])!=wanted:
                    return [a,b,noise]
    raise ValueError('no failure witness')


def margin(p,n,repair_noise):
    for bias in range(p):
        for wa in range(p):
            for wb in range(p):
                if all([read(n,i) for i in rotate(p,n,noise,[bias,wa,wb])]==[1,1,1,-1] for noise in range(repair_noise+1)):
                    return [bias,wa,wb]
    raise ValueError('no repair witness')
