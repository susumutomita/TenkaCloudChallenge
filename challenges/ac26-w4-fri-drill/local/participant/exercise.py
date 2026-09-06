"""The visible one-digit example and argument names, without deployment answers."""
ROW_ARGS={'poly':('qs','p'),'fold':('qs','beta','p'),
'fold2':('qs','beta','beta2','p'),'query':('qs','x','p'),
'recover':('qs','x','p'),'consistency':('qs','beta','x','p'),
'cheat-caught':('qs','beta','x','d0','d1','p'),'miss-points':('x','p')}
EXAMPLE={'p':5,'q0':1,'q1':2,'q2':3,'q3':1,'beta':1,'beta2':2,'x':1,'d0':1,'d1':1}
EXAMPLE_EXPECTED={'poly':(1,2,0),'fold':(3,2,1),'fold2':1,
'query':(2,1),'recover':(4,3,4,3),'consistency':(2,2),
'cheat-caught':(2,4)}


def call_row(module,row,values):
    args=dict(values,qs=tuple(values[k] for k in ('q0','q1','q2','q3')))
    return getattr(module,row.replace('-','_'))(*[args[name] for name in ROW_ARGS[row]])


def construction_valid(answer, values):
    """Public constraints, not a chosen answer: accept any valid pair of alterations."""
    if not isinstance(answer,(tuple,list)) or len(answer)!=6:
        return False
    p=values['p'];x=values['x']
    if any(type(n) is not int or not 0<=n<p for n in answer):
        return False
    a0,a1,b0,b1,b2,b3=answer
    if a1==0 or b0==0 or (p==5 and b3!=0):
        return False
    if (a0+a1*x*x)%p!=0:
        return False
    for t in range(1,p):
        y=t*t%p
        if (b0+b1*y+b2*y*y+b3*y*y*y)%p!=0:
            return False
    return True
