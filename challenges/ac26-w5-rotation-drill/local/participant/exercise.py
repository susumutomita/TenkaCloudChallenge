"""Public example and argument names only; no deployment answers."""
ROW_ARGS={'params':('p','q','n'),'phase':('q','s','a','b'),'testpoly':('p','n','shift'),
'rescale':('p','q','n','a','b'),'index':('q','n','s','a','b'),
'readout':('p','q','n','s','a','b','shift'),'window':('p','q','n','shift'),'edge':('p','n','shift','offsets')}
EXAMPLE={'p':4,'q':16,'n':4,'s':[1,0],'a':[3,2],'b':8,'shift':1,'offsets':[-1,0]}
EXAMPLE_EXPECTED={'params':(4,16,4,4),'phase':5,'testpoly':(1,0,0,0),'rescale':(2,2,4),'index':2,'readout':0}


def call_row(module,row,values):
    return getattr(module,row)(*[values[name] for name in ROW_ARGS[row]])
