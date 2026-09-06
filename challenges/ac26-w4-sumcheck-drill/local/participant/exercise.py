"""Public worked example and row argument names, without deployment answers."""
ROW_ARGS={'circuit':('p','x'),'mle':('p','x'),'grid':('p','x'),
'round1':('p','first','r1'),'final-check':('p','x','second','r1','r2'),
'lie':('p','first','r1','d'),'lie-caught':('p','first','second','r1','r2','d'),
'miss-points':('p','first','second','r1','d')}
EXAMPLE={'p':5,'x':[1,1,1,1],'first':[3,1,1],'r1':2,'second':[0,3,1],'r2':3,'d':1}
EXAMPLE_EXPECTED={'circuit':(2,1,3),'mle':(2,1,0),'grid':(0,3,0,0),'round1':(3,4),'final-check':(4,3,3),'lie':(4,3)}


def call_row(module,row,values):
    return getattr(module,row.replace('-','_'))(*[values[name] for name in ROW_ARGS[row]])
