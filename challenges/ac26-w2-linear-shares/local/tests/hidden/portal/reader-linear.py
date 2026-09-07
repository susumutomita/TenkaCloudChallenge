def add_shares(a,b,p):
    return [(x+y)%p for x,y in zip(a,b)]

def add_constant(shares,c,p):
    out=[s%p for s in shares]
    out[0]=(out[0]+c)%p
    return out

def mul_constant(shares,c,p):
    return [s*c%p for s in shares]

def communication_rounds(operation):
    return {"add-shared":0,"sub-shared":0,"negate-shared":0,"add-constant":0,"mul-constant":0,"mul-shared":1,"square-shared":1,"compare-shared":1}[operation]
