"""The visible one-digit example and argument names, without deployment answers."""
ROW_ARGS={'poly':('qs','p'),'fold':('qs','beta','p'),
'fold2':('qs','beta','beta2','p'),'query':('qs','x','p'),
'recover':('qs','x','p'),'consistency':('qs','beta','x','p'),
'cheat-caught':('qs','beta','x','d0','d1','p'),'miss-points':('d0','d1','p')}
EXAMPLE={'p':5,'q0':1,'q1':2,'q2':3,'q3':1,'beta':1,'beta2':2,'x':1,'d0':1,'d1':1}
EXAMPLE_EXPECTED={'poly':(1,2,0),'fold':(3,2,1),'fold2':1,
'query':(2,1),'recover':(4,3,4,3),'consistency':(2,2),
'cheat-caught':(2,4),'miss-points':(2,3)}


def call_row(module,row,values):
    args=dict(values,qs=tuple(values[k] for k in ('q0','q1','q2','q3')))
    return getattr(module,row.replace('-','_'))(*[args[name] for name in ROW_ARGS[row]])
