"""Supplied formulas: two gates over the SAME prime, including the copy product."""
SIGMA=(0,1,3,4,2,5)

def table(a0,b0,p):
    u=(a0+b0)%p
    return ((a0,b0,u),(u,u,u*u%p))

def addresses(tags,w,p):
    return tuple(pow(w,row,p)*tag%p for row in range(2) for tag in tags)

def sigma_addresses(tags,w,p):
    a=addresses(tags,w,p)
    return tuple(a[i] for i in SIGMA)

def fingerprints(rows,tags,w,p,beta,gamma):
    values=[value for row in rows for value in row]
    left=tuple((v+beta*a+gamma)%p for v,a in zip(values,addresses(tags,w,p)))
    right=tuple((v+beta*a+gamma)%p for v,a in zip(values,sigma_addresses(tags,w,p)))
    return left,right

def products(rows,tags,w,p,beta,gamma):
    left,right=fingerprints(rows,tags,w,p,beta,gamma)
    a=b=1
    for x,y in zip(left,right):a=a*x%p;b=b*y%p
    return a,b

def inverse(a,p):
    for i in range(1,p):
        if a*i%p==1:return i
    raise ValueError('no inverse: the remainder is zero')
