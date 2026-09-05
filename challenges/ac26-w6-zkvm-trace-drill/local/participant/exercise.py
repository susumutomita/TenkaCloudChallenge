"""Public function signatures and the one-digit worked example, never deployment answers."""
ROW_ARGS = {
    'exact':('m','discounts'), 'trace':('m','discounts'), 'overflow':('m','discounts'),
    'decision':('m','discounts','limit'), 'exploit':('m','cases'),
    'predicate':('m','cases'), 'tamper':('m','cases','reports'), 'binding':('m','limit','other_limit'),
}
EXAMPLE = {
    'm':8, 'discounts':[7,2,1], 'limit':3,
    'cases':[
        {'discounts':[1,1,0],'limit':3}, {'discounts':[4,1,0],'limit':3},
        {'discounts':[7,2,1],'limit':3}, {'discounts':[7,5,0],'limit':3},
    ],
    'reports':[True,False,True,True], 'program':3, 'other_program':4, 'other_limit':5,
}
EXAMPLE_EXPECTED = {
    'exact':10, 'trace':[7,1,2], 'overflow':[False,True,False],
    'decision':(True,False), 'exploit':[False,False,True,False],
    'predicate':[False,True,False,True], 'tamper':[False,True,True,False],
}


def call_row(module, row, values):
    return getattr(module,row)(*[values[name] for name in ROW_ARGS[row]])
