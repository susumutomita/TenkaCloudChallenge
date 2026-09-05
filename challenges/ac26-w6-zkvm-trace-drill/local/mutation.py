"""Reject plausible arithmetic and claim mistakes, plus malformed direct submissions."""
from pathlib import Path
import sys,types
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from reference import zkvm_trace_drill as reference
from tests.hidden.check_zkvm_trace_drill import run
from fixtures.generate import GRADED,SHAPES,setting
from verifier import server


def main():
    seed='zkvm-mutation'
    assert not run(reference,seed), run(reference,seed)
    mutations=[
        ('exact returns wrapped total','exact',lambda m,d:sum(d)%m),
        ('trace omits reductions','trace',lambda m,d:[sum(d[:i+1]) for i in range(3)]),
        ('overflow follows full prefix instead of this step','overflow',lambda m,d:[sum(d[:i+1])>=m for i in range(3)]),
        ('overflow always reports no wrap','overflow',lambda m,d:[False]*3),
        ('decision reverses machine and reference','decision',lambda m,d,l:(sum(d)<=l,sum(d)%m<=l)),
        ('exploit needs only excess total','exploit',lambda m,c:[sum(x['discounts'])>x['limit'] for x in c]),
        ('exploit uses OR','exploit',lambda m,c:[sum(x['discounts'])%m<=x['limit'] or sum(x['discounts'])>x['limit'] for x in c]),
        ('predicate calls every real exploit a counterexample','predicate',reference.exploit),
        ('tamper trusts reported values','tamper',lambda m,c,r:r),
        ('binding constructs no overflow','binding',lambda m,l,o:[0,0,0]),
        ('binding makes both programs accept','binding',lambda m,l,o:[m-1,1,0]),
        ('binding uses out-of-range inputs','binding',lambda m,l,o:[m,l+1,0]),
    ]
    killed=0
    for label,row,bad in mutations:
        mutant=types.SimpleNamespace(**{k:getattr(reference,k) for k in GRADED})
        setattr(mutant,row,bad)
        failures=run(mutant,seed)
        if not failures:raise AssertionError('SURVIVED '+label)
        print('KILLED '+label)
        killed+=1
    server.SEED=seed
    correct=setting(seed)['expected']
    for row in GRADED:
        assert server.evaluate(row,correct[row]),row
        value=correct[row]
        if row=='binding':
            wrong=[0,0,0]
        elif isinstance(value,tuple):
            wrong=list(value)
            wrong[0]=not wrong[0] if SHAPES[row][0]=='bool' else wrong[0]+1
        else:wrong=value+1
        assert not server.evaluate(row,wrong),row
        assert not server.evaluate(row,None),row
        if isinstance(value,tuple):assert not server.evaluate(row,list(value)[:-1]),row
        print('KILLED wrong submitted value for '+row)
        killed+=1
    print(f'All {killed} mutations killed.')
    return 0


if __name__=='__main__':raise SystemExit(main())
