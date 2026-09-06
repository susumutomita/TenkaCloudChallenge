"""Private deterministic teaching fixture; no solutions enter participant images.

All gate, address and fingerprint arithmetic uses p=7. Row labels 1,w=6 form
a two-position cycle; the permuted column tags 1,2,3 give six distinct addresses.
The visible beta/gamma detect the displayed one-input alteration but allow a
nonzero-product counterexample changing both copied inputs. This deliberately
selected teaching condition is public, not a random protocol security claim.
"""
import ast,hashlib
from functools import lru_cache
from itertools import permutations

LINES=GRADED=('outputs','bad-row','addresses','sigma-addresses','marks','grand-product','bad-product','miss-count')
TUPLE_LINES={'outputs':2,'bad-row':3,'addresses':6,'sigma-addresses':6,'marks':3,'grand-product':2,'bad-product':2,'miss-count':3}

def draw(seed,label,n):
    return int.from_bytes(hashlib.sha256(f'{seed}:{label}'.encode()).digest()[:8],'big')%n

def _products(values,addr,permuted,beta,gamma,p):
    left=right=1
    for value,a,b in zip(values,addr,permuted):
        left=left*(value+beta*a+gamma)%p
        right=right*(value+beta*b+gamma)%p
    return left,right

@lru_cache(maxsize=64)
def setting(seed):
    p=7;w=6
    a0=1+draw(seed,'a0',6);b0=1+draw(seed,'b0',6)
    if (a0+b0)%p==0:b0=b0%6+1
    u=(a0+b0)%p
    honest=[a0,b0,u,u,u,u*u%p]
    tags=list(permutations((1,2,3)))[draw(seed,'tags',6)]
    addr=[tag*pow(w,row,p)%p for row in range(2) for tag in tags]
    perm=[addr[i] for i in (0,1,3,4,2,5)]
    options=[(beta,gamma) for beta in range(1,p) for gamma in range(p)]
    offset=draw(seed,'challenge',len(options));options=options[offset:]+options[:offset]
    for beta,gamma in options:
        if _products(honest,addr,perm,beta,gamma,p)[0]==0:continue
        shifts=[]
        for g in range(1,p):
            l=(u+g)%p;bad=honest[:3]+[l,u,l*u%p]
            left,right=_products(bad,addr,perm,beta,gamma,p)
            if left and right and left!=right:shifts.append(g)
        if not shifts:continue
        possible=False
        for l in range(p):
            if l==u:continue
            for r in range(p):
                if r==u:continue
                fake=honest[:3]+[l,r,l*r%p]
                left,right=_products(fake,addr,perm,beta,gamma,p)
                if left and left==right:possible=True;break
            if possible:break
        if possible:
            g=shifts[draw(seed,'g',len(shifts))]
            return {'public':dict(p=p,a0=a0,b0=b0,g=g,w=w,k0=tags[0],k1=tags[1],k2=tags[2],beta=beta,gamma=gamma)}
    raise ValueError('no teaching fixture satisfies the published construction conditions')

def assignments(seed):
    v=setting(seed)['public']
    return '\n'.join([f"p = {v['p']}",f"a0, b0 = {v['a0']}, {v['b0']}",f"g = {v['g']}",f"w = {v['w']}",f"k0, k1, k2 = {v['k0']}, {v['k1']}, {v['k2']}",f"beta, gamma = {v['beta']}, {v['gamma']}"])

def submission_binding(seed):
    return hashlib.sha256(('ac26-w4-plonk-drill:submission:v2\0'+seed).encode()).hexdigest()

def normalize_answer(line,raw):
    if line not in GRADED:return None
    if isinstance(raw,str):
        try:raw=ast.literal_eval(raw.strip())
        except (ValueError,SyntaxError,TypeError,RecursionError):return None
    if not isinstance(raw,(list,tuple)) or len(raw)!=TUPLE_LINES[line]:return None
    return tuple(raw) if all(type(n) is int for n in raw) else None
