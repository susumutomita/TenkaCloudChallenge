"""A public practice fixture; all deployment answers remain private."""
ROW_ARGS={'params':('p','n'),'wrap':('lo','hi','n'),'signs':('n','probes'),
'boundary':('n',),'hazard':('n','lo'),'rotations':('p','n','noise_a','noise_b'),
'constants':('p','n','dmax','repair_noise'),'margin':('p','n','repair_noise')}
EXAMPLE={'p':16,'n':8,'noise_a':1,'noise_b':0,'dmax':1,'lo':2,'hi':9,'probes':[0,7,8,9,15,16],'repair_noise':2}
EXAMPLE_EXPECTED={'params':(16,16,8,1),'wrap':(3,-1,11),'signs':(1,1,-1,-1,-1,1),'boundary':8,'hazard':(10,-1),'rotations':(2,0,0,14)}


def call_row(module,row,values):
    return getattr(module,row)(*[values[name] for name in ROW_ARGS[row]])
