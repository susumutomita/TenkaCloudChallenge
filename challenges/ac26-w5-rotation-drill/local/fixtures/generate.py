"""Private small fixtures and property-based construction grading."""
import ast,hashlib
LINES=GRADED=('params','phase','testpoly','rescale','index','readout','window','edge')
SHAPES=((4,8,32),(8,8,32))  # p,n,q; rescaling differs from identity

def draw(seed,label,low,high):
    return low+int.from_bytes(hashlib.sha256(f'{seed}:{label}'.encode()).digest()[:8],'big')%(high-low+1)


def constant_term(values,i):
    n=len(values);i%=2*n
    return values[i] if i<n else -values[i-n]


def answers_table(p,n,shift):
    slot=2*n//p;half=p//2
    return [(min((j+slot//2)//slot,half-1)+shift)%half for j in range(n)]


def valid_window(public,pair):
    if not isinstance(pair,(list,tuple)) or len(pair)!=2 or any(type(x) is not int for x in pair):return False
    p,q,n,shift=[public[k] for k in ('p','q','n','shift')]
    a,b=pair
    if not (0<=a<q and 0<=b<q):return False
    message,noise=divmod((b-a)%q,q//p)
    if not (message<p//2 and 0<noise<(q//p)/2):return False
    left=(round(b*2*n/q)-round(a*2*n/q))%(2*n)
    right=round(((b-a)%q)*2*n/q)%(2*n)
    values=answers_table(p,n,shift)
    return constant_term(values,left)!=constant_term(values,right)


def valid_edge(public,values):
    p,n,shift=[public[k] for k in ('p','n','shift')]
    if not isinstance(values,(list,tuple)) or len(values)!=n or any(type(x) is not int or not -(p//2-1)<=x<=p//2-1 for x in values):return False
    slot=2*n//p
    for message in range(p//2):
        for delta in public['offsets']:
            if constant_term(values,message*slot+delta)!=(message+shift)%(p//2):return False
    return True


def setting(seed):
    p,n,q=SHAPES[draw(seed,'shape',0,len(SHAPES)-1)];D=q//p;slot=2*n//p
    count=draw(seed,'dimension',2,3)
    s=[draw(seed,f's-{i}',0,1) for i in range(count)]
    if not any(s):s[0]=1
    shift=draw(seed,'shift',1,p//2-1)
    noise=draw(seed,'noise',1,max(1,D//4));message=draw(seed,'message',0,p//2-1)
    values=answers_table(p,n,shift)
    for retry in range(128):
        a=[draw(seed,f'a-{retry}-{i}',0,min(q-1,9)) for i in range(count)]
        inner=sum(x*y for x,y in zip(a,s))
        def index_for(m):
            b=(inner+D*m+noise)%q
            return (round(b*2*n/q)-sum(round(x*2*n/q)*y for x,y in zip(a,s)))%(2*n)
        if all(constant_term(values,index_for(m))==(m+shift)%(p//2) for m in range(p//2)):break
    else:raise RuntimeError('could not find a valid small fixture')
    b=(inner+D*message+noise)%q;idx=index_for(message)
    public={'p':p,'q':q,'n':n,'s':s,'a':a,'b':b,'shift':shift,'offsets':[-1,0] if slot==2 else [-1,0,1]}
    pair=next(([x,y] for x in range(q) for y in range(q) if valid_window(public,[x,y])),None)
    if pair is None:raise RuntimeError('could not construct a rounding counterexample')
    repaired=[0]*n
    for m in range(p//2):
        for d in public['offsets']:
            i=(m*slot+d)%(2*n);target=(m+shift)%(p//2)
            repaired[i%n]=target if i<n else -target
    if not valid_edge(public,repaired):raise RuntimeError('could not construct a robust table')
    expected={'params':(p,q,n,D),'phase':(b-inner)%q,
      'testpoly':tuple(values),
      'rescale':(round(D*2*n/q),round(a[0]*2*n/q),round(b*2*n/q)),
      'index':idx,'readout':constant_term(values,idx),'window':tuple(pair),'edge':tuple(repaired)}
    return {'public':public,'expected':expected}


def assignments(seed):
    public=setting(seed)['public']
    return '\n'.join(f'{name} = {value!r}' for name,value in public.items())


def submission_binding(seed):
    return hashlib.sha256(('ac26-w5-rotation-drill:submission:v2\0'+seed).encode()).hexdigest()


def normalize_answer(line,raw):
    if line not in GRADED:return None
    if isinstance(raw,str):
        try:raw=ast.literal_eval(raw.strip())
        except (ValueError,SyntaxError,TypeError,RecursionError):return None
    if line in ('phase','index','readout'):
        return raw if type(raw) is int else None
    if not isinstance(raw,(list,tuple)) or any(type(x) is not int for x in raw):return None
    width={'params':4,'rescale':3,'window':2}.get(line)
    if width is not None and len(raw)!=width:return None
    return tuple(raw)
