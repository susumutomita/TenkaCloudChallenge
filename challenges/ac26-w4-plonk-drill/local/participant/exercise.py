"""Public worked example and construction conditions; no deployment solution."""
from participant.model import table,products
ROW_ARGS={'outputs':('a0','b0','p'),'bad-row':('u','g','p'),
'addresses':('tags','w','p'),'sigma-addresses':('tags','w','p'),
'marks':('rows','tags','w','p','beta','gamma'),
'grand-product':('rows','tags','w','p','beta','gamma'),
'bad-product':('bad','tags','w','p','beta','gamma'),
'miss-count':('rows','tags','w','p','beta','gamma')}
EXAMPLE={'p':7,'a0':1,'b0':2,'g':1,'w':6,'k0':1,'k1':2,'k2':3,'beta':1,'gamma':0}
EXAMPLE_EXPECTED={'outputs':(3,2),'bad-row':(4,3,5),'addresses':(1,2,3,6,5,4),'sigma-addresses':(1,2,6,5,3,4),'marks':(2,4,6),'grand-product':(2,2),'bad-product':(1,6)}

def call_row(module,row,values):
    args=dict(values);p=values['p'];rows=table(values['a0'],values['b0'],p)
    u=rows[0][2];l=(u+values['g'])%p
    args.update(rows=rows,u=u,tags=tuple(values[k] for k in ('k0','k1','k2')),bad=(rows[0],(l,u,l*u%p)))
    return getattr(module,row.replace('-','_'))(*[args[name] for name in ROW_ARGS[row]])

def construction_valid(answer,values):
    if not isinstance(answer,(list,tuple)) or len(answer)!=3:return False
    p=values['p']
    if any(type(n) is not int or not 0<=n<p for n in answer):return False
    rows=table(values['a0'],values['b0'],p);u=rows[0][2];l,r,o=answer
    if l==u or r==u or l*r%p!=o:return False
    tags=tuple(values[k] for k in ('k0','k1','k2'))
    left,right=products((rows[0],tuple(answer)),tags,values['w'],p,values['beta'],values['gamma'])
    return left==right and left!=0
