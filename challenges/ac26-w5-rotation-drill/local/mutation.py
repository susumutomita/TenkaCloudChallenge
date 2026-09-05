"""Author-only mutations for rounding order, signed reads and construction conditions."""
from pathlib import Path
import sys,types
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from reference import rotation_drill as reference
from tests.hidden.check_rotation_drill import run
from fixtures.generate import GRADED,setting
from participant.model import rh,table,read
from verifier import server


def main():
    seeds=['rotation-mutation','reader-rotation']+[f'mutation-{i}' for i in range(20)]
    for seed in seeds:assert not run(reference,seed),run(reference,seed)
    mutations=[
        ('wrong message spacing','params',lambda p,q,n:(p,q,n,q//n)),
        ('adds mask','phase',lambda q,s,a,b:(b+sum(x*y for x,y in zip(a,s)))%q),
        ('ignores key','phase',lambda q,s,a,b:b%q),
        ('no answer shift','testpoly',lambda p,n,h:table(p,n,0)),
        ('truncates instead of rounding','rescale',lambda p,q,n,a,b:(int(q//p*2*n/q),int(a[0]*2*n/q),int(b*2*n/q))),
        ('rounds the difference','index',lambda q,n,s,a,b:rh(q,n,reference.phase(q,s,a,b))%(2*n)),
        ('returns position rather than answer','readout',lambda p,q,n,s,a,b,h:reference.index(q,n,s,a,b)),
        ('zero noise counterexample','window',lambda p,q,n,h:[0,0]),
        ('same-answer different positions','window',lambda p,q,n,h:[1,4]),
        ('old fragile table','edge',lambda p,n,h,d:table(p,n,h)),
        ('forgets sign on negative positions','edge',lambda p,n,h,d:[abs(x) for x in reference.edge(p,n,h,d)]),
        ('all zeros','edge',lambda p,n,h,d:[0]*n),
    ]
    for label,row,bad in mutations:
        mutant=types.SimpleNamespace(**{k:getattr(reference,k) for k in GRADED})
        setattr(mutant,row,bad)
        assert any(run(mutant,seed) for seed in seeds),'SURVIVED '+label
        print('KILLED '+label)
    server.SEED=seeds[0]
    expected=setting(seeds[0])['expected']
    for row in GRADED:
        value=expected[row]
        assert server.evaluate(row,value),row
        if row=='window':wrong=[0,0]
        elif row=='edge':wrong=[0]*len(value)
        elif isinstance(value,tuple):
            wrong=list(value);wrong[0]+=1
            assert not server.evaluate(row,list(value)[:-1]),row
        else:wrong=value+1
        assert not server.evaluate(row,wrong),row
        assert not server.evaluate(row,None),row
        print('KILLED wrong submitted value for '+row)
    print(f'All {len(mutations)+len(GRADED)} mutations killed.')
    return 0


if __name__=='__main__':raise SystemExit(main())
