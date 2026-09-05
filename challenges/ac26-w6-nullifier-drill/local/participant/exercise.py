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
    'message':[True,True],
}


def call_row(module, row, values):
    return getattr(module,row)(*[values[name] for name in ROW_ARGS[row]])


def valid_order(public, order):
    if not isinstance(order,(list,tuple)) or len(order)!=4 or any(type(i) is not int or not 1<=i<=6 for i in order) or len(set(order))!=4:
        return False
    seen=set(); early=set(); correct=wrong=0
    for index in order:
        item=public['attempts'][index-1]
        marker=item['nullifier']
        eligible=item['verified'] and item['scope']==public['scope']
        if eligible and marker not in seen:
            correct+=1;seen.add(marker)
        fresh=marker not in early
        early.add(marker)  # the deliberate bug: consume before verification/scope checks
        wrong+=bool(fresh and eligible)
    return correct==2 and wrong==0


def valid_schedule(public, rows):
    if not isinstance(rows,(list,tuple)) or len(rows)!=5:
        return False
    p=public['p'];scope=public['scope']
    for row in rows:
        if not isinstance(row,(list,tuple)) or len(row)!=3 or any(type(x) is not int for x in row):return False
        secret,election,vote=row
        if not (0<=secret<p and election in (scope,scope+1) and vote in (0,1)):return False
    if tuple(rows[0][:2])!=(public['secret'],scope):return False
    if len({r[0] for r in rows})<3 or len({r[1] for r in rows})!=2 or len({r[2] for r in rows})!=2:return False
    identity={(e,s) for s,e,v in rows}
    scoped={(e,(s*s+e)%p) for s,e,v in rows}
    global_markers={(s*s+e)%p for s,e,v in rows}
    vote_markers={(e,(s*s+e+v)%p) for s,e,v in rows}
    return tuple(map(len,(identity,scoped,global_markers,vote_markers)))==(4,3,2,4)
