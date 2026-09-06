"""Author-only mutations representing arithmetic and construction mistakes."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from tests.hidden.check_clock_drill import run

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('clock_reference', ROOT/'reference/clock_drill.py')
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
SEEDS = tuple('clock-mutation-' + str(i) for i in range(20))
MUTANTS = [
    ('addition without final remainder','add', lambda u,v,n: (u+v,(u%n+v%n)%n,0)),
    ('multiplication without final remainder','mul', lambda u,v,n: (u*v,(u%n)*(v%n)%n,0)),
    ('omitting the comparison difference','add', lambda u,v,n: ((u+v)%n,(u+v)%n)),
    ('adding a cover without wrapping','covered',lambda s,c,n: s+c),
    ('adding the cover again to undo it','uncovered',lambda s,c,n: ((s+c)%n+c)%n),
    ('returning three counts instead of covers','every',lambda s,c,n: (1,1,1)),
    ('reversing the cover subtraction','every',lambda s,c,n: tuple((a-(s+c)%n)%n for a in (s,(s+1)%n,((s+c)%n+3)%n))),
    ('one pair instead of all candidates','count',lambda s,c,n: 1),
    ('returning observations instead of a construction','reuse',lambda first,x,y,n: (x,y)),
    ('copying the actual first original','reuse',lambda first,x,y,n: (first,(y-x+first)%n,(x-first)%n)),
    ('using a different cover on the second message','reuse',lambda first,x,y,n: ((first+1)%n,(y-x+first+2)%n,(x-first-1)%n)),
    ('forgetting to normalize the chosen first original','reuse',lambda first,x,y,n: (first+n,(y-x+first)%n,(x-first)%n)),
    ('reversing the leaked difference','leak',lambda first,x,y,n: (first-y+x)%n),
    ('returning only the gap','leak',lambda first,x,y,n: (x-y)%n),
]


def main():
    for seed in SEEDS:
        errors=run(reference,seed)
        if errors:
            print('FAIL reference',errors)
            return 1
    print('PASS reference across',len(SEEDS),'practice records')
    survivors=[]
    for label,name,broken in MUTANTS:
        mutant=SimpleNamespace(**vars(reference))
        setattr(mutant,name,broken)
        killed=any(run(mutant,seed) for seed in SEEDS)
        print('KILLED' if killed else 'SURVIVED',label)
        if not killed:survivors.append(label)
    return bool(survivors)


if __name__ == '__main__':
    raise SystemExit(main())
