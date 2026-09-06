"""Visible arithmetic rules for signed rotation and a two-input logic gate."""
PAIRS=((0,0),(0,1),(1,0),(1,1))


def read(n,position):
    """Read the all-ones table; one n-position lap negates, two restore."""
    return 1 if position%(2*n)<n else -1


def rotations(p,n,noise,encoding,coefficients=None):
    """Return four positions in PAIRS order; noise is the total downward displacement."""
    if coefficients is None:
        coefficients=(1,encoding[1],encoding[1])
    bias,weight_a,weight_b=coefficients
    q=2*n;D=q//p
    values=[]
    for a,b in PAIRS:
        phase=(bias-weight_a*encoding[a]-weight_b*encoding[b])%p
        values.append((D*phase-noise)%q)
    return values


def valid_failure(public,candidate):
    if not isinstance(candidate,(list,tuple)) or len(candidate)!=3 or any(type(x) is not int for x in candidate):return False
    a,b,noise=candidate
    if a not in (0,1) or b not in (0,1) or not public['dmax']<noise<=public['repair_noise']:return False
    position=rotations(public['p'],public['n'],noise,public['encoding'])[2*a+b]
    wanted=-1 if a==b==1 else 1
    return read(public['n'],position)!=wanted


def valid_repair(public,coefficients):
    p,n=public['p'],public['n']
    if not isinstance(coefficients,(list,tuple)) or len(coefficients)!=3 or any(type(x) is not int or not -3<=x<=3 for x in coefficients):return False
    for noise in range(public['repair_noise']+1):
        values=rotations(p,n,noise,public['encoding'],coefficients)
        if [read(n,i) for i in values]!=[1,1,1,-1]:return False
    return True
