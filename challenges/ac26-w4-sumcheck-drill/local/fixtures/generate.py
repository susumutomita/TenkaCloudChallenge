"""Private small fixtures and independent validation of false-message constructions."""
import ast,hashlib,itertools
LINES=GRADED=('circuit','mle','grid','round1','final-check','lie','lie-caught','miss-points')
PRIMES=(5,7)


def draw(seed,label,low,high):
    return low+int.from_bytes(hashlib.sha256(f'{seed}:{label}'.encode()).digest()[:8],'big')%(high-low+1)


def evaluate(p,c,t):
    return (c[0]+c[1]*t+c[2]*t**2)%p


def required_sum(public):
    return (evaluate(public['p'],public['first'],public['r1'])+public['d']*(1-public['r1']))%public['p']


def valid_coefficients(p,c):
    return isinstance(c,(list,tuple)) and len(c)==3 and all(type(x) is int and 0<=x<p for x in c)


def valid_spoof(public,candidate):
    p=public['p']
    if not valid_coefficients(p,candidate):return False
    return (2*candidate[0]+candidate[1]+candidate[2])%p==required_sum(public) and evaluate(p,candidate,public['r2'])==evaluate(p,public['second'],public['r2'])


def valid_pair(public,pair):
    p=public['p']
    if not isinstance(pair,(list,tuple)) or len(pair)!=2 or not all(valid_coefficients(p,c) for c in pair):return False
    matches=[]
    for c in pair:
        if (2*c[0]+c[1]+c[2])%p!=required_sum(public):return False
        hits=[t for t in range(p) if evaluate(p,c,t)==evaluate(p,public['second'],t)]
        if len(hits)!=2:return False
        matches.append(hits)
    return all(t not in matches[1] for t in matches[0])


def setting(seed):
    p=PRIMES[draw(seed,'p',0,1)]
    for retry in range(128):
        x=[draw(seed,f'x-{retry}-{i}',1,p-1) for i in range(4)]
        y0=(x[0]+x[1])%p;y1=x[2]*x[3]%p;out=(y0+y1)%p
        if y0 and y1 and y0!=y1 and out:break
    else:raise RuntimeError('no nondegenerate small circuit')
    first=[out,(-2*y0)%p,(y0-y1)%p]
    choices=[r for r in range(2,p) if evaluate(p,first,r)!=out]
    r1=choices[draw(seed,'r1',0,len(choices)-1)];r2=draw(seed,'r2',0,p-1)
    w=lambda z:(y0*(1-z)+y1*z)%p
    second=[0,((1-r1)*(w(r1)+y0))%p,((1-r1)*(y1-y0))%p]
    d=draw(seed,'d',1,p-1)
    public={'p':p,'x':x,'first':first,'r1':r1,'second':second,'r2':r2,'d':d}
    spoof=next((c for c in itertools.product(range(p),repeat=3) if valid_spoof(public,c)),None)
    candidates=[];pair=None
    for c in itertools.product(range(p),repeat=3):
        if (2*c[0]+c[1]+c[2])%p!=required_sum(public):continue
        hits=[t for t in range(p) if evaluate(p,c,t)==evaluate(p,second,t)]
        if len(hits)!=2:continue
        for previous in candidates:
            if valid_pair(public,[previous,c]):pair=(tuple(previous),tuple(c));break
        if pair is not None:break
        candidates.append(c)
    if spoof is None or pair is None:raise RuntimeError('construction has no witness')
    expected={'circuit':(y0,y1,out),'mle':(y0,y1,w(2)),
      'grid':(0,out,0,0),'round1':((evaluate(p,first,0)+evaluate(p,first,1))%p,evaluate(p,first,r1)),
      'final-check':((evaluate(p,second,0)+evaluate(p,second,1))%p,evaluate(p,second,r2),((1-r1)*r2*(w(r1)+w(r2)))%p),
      'lie':((out+d)%p,required_sum(public)),'lie-caught':tuple(spoof),'miss-points':pair}
    return {'public':public,'expected':expected}


def assignments(seed):
    return '\n'.join(f'{key} = {value!r}' for key,value in setting(seed)['public'].items())


def submission_binding(seed):
    return hashlib.sha256(('ac26-w4-sumcheck-drill:submission:v2\0'+seed).encode()).hexdigest()


def normalize_answer(line,raw):
    if line not in GRADED:return None
    if isinstance(raw,str):
        try:raw=ast.literal_eval(raw.strip())
        except (ValueError,SyntaxError,TypeError,RecursionError):return None
    if line=='miss-points':
        if not isinstance(raw,(list,tuple)) or len(raw)!=2:return None
        if any(not isinstance(c,(list,tuple)) or len(c)!=3 or any(type(v) is not int for v in c) for c in raw):return None
        return tuple(tuple(c) for c in raw)
    width={'circuit':3,'mle':3,'grid':4,'round1':2,'final-check':3,'lie':2,'lie-caught':3}[line]
    if not isinstance(raw,(list,tuple)) or len(raw)!=width or any(type(x) is not int for x in raw):return None
    return tuple(raw)
