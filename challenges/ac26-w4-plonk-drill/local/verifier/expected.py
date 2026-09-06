"""Independent verifier arithmetic; no participant code is imported or executed."""
from fixtures.generate import setting

def context(seed):
    v=setting(seed)['public'];p=v['p'];w=v['w'];u=(v['a0']+v['b0'])%p
    rows=((v['a0'],v['b0'],u),(u,u,u*u%p))
    tags=tuple(v[k] for k in ('k0','k1','k2'))
    addr=tags+tuple(w*k%p for k in tags)
    return v,rows,addr,(addr[0],addr[1],addr[3],addr[4],addr[2],addr[5])

def product_pair(rows,addr,swapped,v):
    values=list(rows[0])+list(rows[1]);result=[]
    for labels in (addr,swapped):
        product=1
        for i,value in enumerate(values):product=product*(value+v['beta']*labels[i]+v['gamma'])%v['p']
        result.append(product)
    return tuple(result)

def expected_for(seed):
    v,rows,addr,swapped=context(seed);p=v['p'];u=rows[0][2];l=(u+v['g'])%p
    bad=(rows[0],(l,u,l*u%p))
    return {'outputs':(u,u*u%p),'bad-row':bad[1],'addresses':addr,'sigma-addresses':swapped,
    'marks':tuple((n+v['beta']*a+v['gamma'])%p for n,a in zip(rows[0],addr[:3])),
    'grand-product':product_pair(rows,addr,swapped,v),'bad-product':product_pair(bad,addr,swapped,v)}

def valid_construction(seed,answer):
    v,rows,addr,swapped=context(seed);p=v['p']
    if len(answer)!=3 or any(type(n) is not int or not 0<=n<p for n in answer):return False
    l,r,o=answer
    if l==rows[0][2] or r==rows[0][2] or l*r%p!=o:return False
    a,b=product_pair((rows[0],tuple(answer)),addr,swapped,v)
    return a==b and a!=0
