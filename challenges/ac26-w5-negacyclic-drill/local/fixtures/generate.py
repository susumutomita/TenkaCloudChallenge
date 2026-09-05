"""Private fixture and independent validation of the published construction rules."""
import ast,hashlib,itertools
LINES=GRADED=('params','wrap','signs','boundary','hazard','rotations','constants','margin')


def draw(seed,label,low,high):
    return low+int.from_bytes(hashlib.sha256(f'{seed}:{label}'.encode()).digest()[:8],'big')%(high-low+1)


def signed(n,position):
    return 1 if position%(2*n)<n else -1


def outputs(p,n,noise,coefficients):
    bias,wa,wb=coefficients;D=2*n//p
    return [signed(n,D*((bias-wa*(p-1 if a==0 else 1)-wb*(p-1 if b==0 else 1))%p)-noise) for a,b in ((0,0),(0,1),(1,0),(1,1))]


def valid_failure(public,candidate):
    if not isinstance(candidate,(list,tuple)) or len(candidate)!=3 or any(type(x) is not int for x in candidate):return False
    a,b,noise=candidate
    if a not in (0,1) or b not in (0,1) or not public['dmax']<noise<=public['repair_noise']:return False
    return outputs(public['p'],public['n'],noise,(1,1,1))[2*a+b] != (-1 if a==b==1 else 1)


def valid_repair(public,coefficients):
    p,n=public['p'],public['n']
    if not isinstance(coefficients,(list,tuple)) or len(coefficients)!=3 or any(type(x) is not int or not 0<=x<p for x in coefficients):return False
    return all(outputs(p,n,noise,coefficients)==[1,1,1,-1] for noise in range(public['repair_noise']+1))


def setting(seed):
    p,n=16,8;q=2*n;D=q//p;dmax=1
    noise_a=draw(seed,'noise-a',0,1);noise_b=draw(seed,'noise-b',0,dmax-noise_a)
    lo=draw(seed,'low-probe',1,n-2);hi=draw(seed,'high-probe',n+1,2*n-2)
    probes=[draw(seed,f'probe-{i}',-3,2*n+3) for i in range(6)]
    if all(signed(n,i)==1 for i in probes):probes[-1]=n
    elif all(signed(n,i)==-1 for i in probes):probes[-1]=0
    public={'p':p,'n':n,'noise_a':noise_a,'noise_b':noise_b,'dmax':dmax,'lo':lo,'hi':hi,'probes':probes,'repair_noise':draw(seed,'repair-noise',2,3)}
    phases=(3,1,1,p-1)
    rotations=tuple((D*ph-noise_a-noise_b)%q for ph in phases)
    failure=next((v for v in itertools.product((0,1),(0,1),range(dmax+1,public['repair_noise']+1)) if valid_failure(public,v)),None)
    repair=next((v for v in itertools.product(range(p),repeat=3) if valid_repair(public,v)),None)
    if failure is None or repair is None:raise RuntimeError('construction has no witness')
    E=lo+hi
    expected={'params':(p,q,n,D),'wrap':(E%n,1 if E//n%2==0 else -1,E),
      'signs':tuple(signed(n,i) for i in probes),'boundary':n,'hazard':(lo+n,-1),
      'rotations':rotations,'constants':tuple(failure),'margin':tuple(repair)}
    return {'public':public,'expected':expected}


def assignments(seed):
    return '\n'.join(f'{key} = {value!r}' for key,value in setting(seed)['public'].items())


def submission_binding(seed):
    return hashlib.sha256(('ac26-w5-negacyclic-drill:submission:v2\0'+seed).encode()).hexdigest()


def normalize_answer(line,raw):
    if line not in GRADED:return None
    if isinstance(raw,str):
        try:raw=ast.literal_eval(raw.strip())
        except (ValueError,SyntaxError,TypeError,RecursionError):return None
    if line=='boundary':return raw if type(raw) is int else None
    width={'params':4,'wrap':3,'signs':6,'hazard':2,'rotations':4,'constants':3,'margin':3}[line]
    if not isinstance(raw,(list,tuple)) or len(raw)!=width or any(type(x) is not int for x in raw):return None
    return tuple(raw)
