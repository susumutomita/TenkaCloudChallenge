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
      'miss-points':tuple(t for t in range(1,p) if (v['d0']+v['d1']*t*t)%p==0)}
