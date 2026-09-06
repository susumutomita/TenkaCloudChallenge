"""Author-only mutations for arithmetic, message checks and construction conditions."""
from pathlib import Path
import itertools,sys,types
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from reference import sumcheck_drill as reference
from tests.hidden.check_sumcheck_drill import run
from fixtures.generate import GRADED,setting
from participant.model import layer,line,wired,poly
from verifier import server


def endpoint_only(p,first,second,r1,r2,d):
    claim=(poly(p,first,r1)+d*(1-r1))%p
    return next(c for c in itertools.product(range(p),repeat=3)
        if (2*c[0]+c[1]+c[2])%p==claim and poly(p,c,r2)!=poly(p,second,r2))


def repeated_pair(p,first,second,r1,d):
    first_candidate=reference.miss_points(p,first,second,r1,d)[0]
    return [first_candidate,first_candidate]


def main():
    seeds=['reader-sumcheck']+[f'mutation-{i}' for i in range(10)]
    for seed in seeds:assert not run(reference,seed),run(reference,seed)
    mutations=[
        ('multiplies first gate','circuit',lambda p,x:(x[0]*x[1]%p,x[2]*x[3]%p,(x[0]*x[1]+x[2]*x[3])%p)),
        ('swaps line endpoints','mle',lambda p,x:tuple(line(p,layer(p,x)[1],layer(p,x)[0],z) for z in (0,1,2))),
        ('drops negative remainder','mle',lambda p,x:(layer(p,x)[0],layer(p,x)[1],-layer(p,x)[0]+2*layer(p,x)[1])),
        ('selects wrong grid corner','grid',lambda p,x:(layer(p,x)[2],0,0,0)),
        ('omits nonzero first endpoint','round1',lambda p,c,r:(poly(p,c,1),poly(p,c,r))),
        ('omits square at challenge','round1',lambda p,c,r:((poly(p,c,0)+poly(p,c,1))%p,(c[0]+c[1]*r+c[2]*r)%p)),
        ('copies final value into endpoint sum','final-check',lambda p,x,c,r,s:(poly(p,c,s),poly(p,c,s),wired(p,*layer(p,x)[:2],r,s))),
        ('evaluates second at r1','final-check',lambda p,x,c,r,s:((poly(p,c,0)+poly(p,c,1))%p,poly(p,c,r),wired(p,*layer(p,x)[:2],r,s))),
        ('uses d times t instead of 1 minus t','lie',lambda p,c,r,d:((poly(p,c,0)+poly(p,c,1)+d)%p,(poly(p,c,r)+d*r)%p)),
        ('matches only dishonest endpoint sum','lie-caught',endpoint_only),
        ('matches only final truth','lie-caught',lambda p,f,s,r,t,d:s),
        ('duplicates blind spots','miss-points',repeated_pair),
        ('uses honest pair','miss-points',lambda p,f,s,r,d:[s,s]),
        ('replays example spoof','lie-caught',lambda p,f,s,r,t,d:[0,4,4]),
        ('replays example pair','miss-points',lambda p,f,s,r,d:[[0,1,2],[4,1,4]]),
    ]
    for label,row,bad in mutations:
        functions={k.replace('-','_'):getattr(reference,k.replace('-','_')) for k in GRADED}
        functions[row.replace('-','_')]=bad;mutant=types.SimpleNamespace(**functions)
        failures=[f for seed in seeds for f in run(mutant,seed)]
        assert failures,'SURVIVED '+label
        assert not any('raised' in f for f in failures),(label,failures)
        print('KILLED '+label)
    server.SEED=seeds[0];expected=setting(seeds[0])['expected']
    for row in GRADED:
        value=expected[row];assert server.evaluate(row,value),row
        if row=='lie-caught':wrong=setting(seeds[0])['public']['second']
        elif row=='miss-points':wrong=[value[0],value[0]]
        else:wrong=list(value);wrong[0]+=1
        assert not server.evaluate(row,wrong),row
        assert not server.evaluate(row,list(value)[:-1]),row
        assert not server.evaluate(row,None),row
        print('KILLED wrong submitted value for '+row)
    print(f'All {len(mutations)+len(GRADED)} mutations killed.')
    return 0


if __name__=='__main__':raise SystemExit(main())
