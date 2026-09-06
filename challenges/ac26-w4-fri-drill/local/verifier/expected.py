"""Independent arithmetic inside the unpublished verifier, never the workbench."""
from fixtures.generate import setting


def expected_for(seed):
    v=setting(seed)['public'];p=v['p']
    a,b,c,d=[v[k] for k in ('q0','q1','q2','q3')]
    beta,beta2,x=[v[k] for k in ('beta','beta2','x')]
    q=lambda t: (a+t*(b+t*(c+t*d)))%p
    first=(a+beta*b)%p; slope=(c+beta*d)%p
    folded=lambda t:(first+slope*t)%p
    y=x*x%p;e=(a+c*y)%p;o=(b+d*y)%p
    return {'poly':tuple(q(t) for t in (0,1,2)),
      'fold':tuple(folded(t) for t in (0,1,2)),
      'fold2':(first+beta2*slope)%p,
      'query':(q(x),q(-x)), 'recover':(e,o,e,o),
      'consistency':((e+beta*o)%p,folded(y)),
      'cheat-caught':(folded(y),(folded(y)+v['d0']+v['d1']*y)%p),
      # One author-test witness; the verifier accepts all solutions of the constraints.
      'miss-points':((-x*x)%p,1,p-1,0,1 if p==5 else 0,0 if p==5 else 1)}


def valid_construction(seed, answer):
    """Independent check of both counterexamples; no exact-solution comparison."""
    v=setting(seed)['public'];p=v['p'];x=v['x']
    if len(answer)!=6 or any(type(n) is not int or n<0 or n>=p for n in answer):
        return False
    a=answer[:2];b=answer[2:]
    if a[1]==0 or b[0]==0 or (p==5 and b[3]!=0):
        return False
    if (a[0]+a[1]*x*x)%p:
        return False
    for t in range(1,p):
        y=pow(t,2,p)
        if (((b[3]*y+b[2])*y+b[1])*y+b[0])%p:
            return False
    return True
