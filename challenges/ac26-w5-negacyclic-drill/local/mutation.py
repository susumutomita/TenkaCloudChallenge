"""Author-only mutations for signed wrap, noise failures and all-input repairs."""
from pathlib import Path
import sys,types
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from reference import negacyclic_drill as reference
from tests.hidden.check_negacyclic_drill import run
from fixtures.generate import GRADED,setting
from participant.model import rotations
from verifier import server


def main():
    seeds=['reader-negacyclic']+[f'mutation-{i}' for i in range(10)]
    for seed in seeds:assert not run(reference,seed),run(reference,seed)
    mutations=[
        ('uses one sign-flipped lap as cycle','params',lambda p,n:(p,n,n,n//p)),
        ('discards wrap sign','wrap',lambda lo,hi,n:((lo+hi)%n,1,lo+hi)),
        ('every removed lap stays negative','wrap',lambda lo,hi,n:((lo+hi)%n,-1,lo+hi)),
        ('reduces signs by n','signs',lambda n,probes:[1]*6),
        ('boundary off by one','boundary',lambda n:n-1),
        ('extra lap does not flip','hazard',lambda n,lo:(lo+n,1)),
        ('adds instead of subtracting noise','rotations',lambda p,n,a,b:rotations(p,n,-a-b)),
        ('ignores second noise','rotations',lambda p,n,a,b:rotations(p,n,a)),
        ('safe-noise failure claim','constants',lambda p,n,d,r:[0,1,d]),
        ('wrong-input failure claim','constants',lambda p,n,d,r:[0,0,d+1]),
        ('keeps fragile original coefficients','margin',lambda p,n,r:[1,1,1]),
        ('out-of-range coefficients','margin',lambda p,n,r:[p,2,2]),
    ]
    for label,row,bad in mutations:
        mutant=types.SimpleNamespace(**{k:getattr(reference,k) for k in GRADED})
        setattr(mutant,row,bad)
        assert any(run(mutant,seed) for seed in seeds),'SURVIVED '+label
        print('KILLED '+label)
    server.SEED=seeds[0];expected=setting(seeds[0])['expected']
    for row in GRADED:
        value=expected[row];assert server.evaluate(row,value),row
        if row=='constants':wrong=[0,1,0]
        elif row=='margin':wrong=[1,1,1]
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
