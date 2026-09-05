"""Public inputs and one-digit example; no deployment answers."""
ROW_ARGS = {
    'label':('p','secret','scope'), 'repeat':('p','secret','scope','messages'),
    'scopes':('p','secret','scope_ids'), 'accept':('scope','attempts'),
    'count':('scope','attempts'), 'message':('p','secret','scope','messages'),
    'unchecked':('scope','attempts'), 'collision':('p','secret','scope'),
}
EXAMPLE = {
    'p':7,'secret':2,'scope':1,'scope_ids':[1,2],'messages':[0,1],
    'attempts':[
        {'verified':False,'scope':1,'nullifier':5},
        {'verified':True,'scope':1,'nullifier':5},
        {'verified':True,'scope':1,'nullifier':5},
        {'verified':True,'scope':2,'nullifier':3},
        {'verified':True,'scope':1,'nullifier':3},
        {'verified':True,'scope':1,'nullifier':2},
    ],
}
EXAMPLE_EXPECTED = {
    'label':5,'repeat':[5,5],'scopes':[5,6],
    'accept':[False,True,False,False,True,True],'count':3,
    'message':[True,True],'unchecked':[True,False,False,False,False,False],
    'collision':5,
}


def call_row(module, row, values):
    return getattr(module,row)(*[values[name] for name in ROW_ARGS[row]])
