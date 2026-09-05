"""Author-only mutations for marker stability, verification order and collisions."""
from pathlib import Path
import sys,types
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from reference import nullifier_drill as reference
from tests.hidden.check_nullifier_drill import run
from fixtures.generate import GRADED,SHAPES,setting
from verifier import server


def flawed_accept(scope, attempts, proof=True, election=True, record=True):
    seen=[]; answers=[]
    for a in attempts:
        ok=(a['verified'] or not proof) and (a['scope']==scope or not election) and a['nullifier'] not in seen
        answers.append(ok)
        if ok and record:seen.append(a['nullifier'])
    return answers


def main():
    seed='nullifier-mutation'
    assert not run(reference,seed),run(reference,seed)
    mutations=[
        ('label is constant','label',lambda p,s,c:0),
        ('repeat incorporates the vote','repeat',lambda p,s,c,ms:[(s*s+c+v)%p for v in ms]),
        ('scopes ignores election changes','scopes',lambda p,s,cs:[(s*s+cs[0])%p]*2),
        ('accept skips verification','accept',lambda c,a:flawed_accept(c,a,proof=False)),
        ('accept skips election matching','accept',lambda c,a:flawed_accept(c,a,election=False)),
        ('accept never records used markers','accept',lambda c,a:flawed_accept(c,a,record=False)),
        ('count counts all requests','count',lambda c,a:len(a)),
        ('count counts only proof flags','count',lambda c,a:sum(v['verified'] for v in a)),
        ('message reports the correct rather than flawed design','message',lambda p,s,c,ms:[True,False]),
        ('unchecked sees no false acceptance','unchecked',lambda c,a:[False]*len(a)),
        ('collision returns the same secret','collision',lambda p,s,c:s),
        ('collision returns out of range','collision',lambda p,s,c:p),
    ]
    for label,row,bad in mutations:
        mutant=types.SimpleNamespace(**{k:getattr(reference,k) for k in GRADED})
        setattr(mutant,row,bad)
        assert run(mutant,seed),'SURVIVED '+label
        print('KILLED '+label)
    server.SEED=seed
    expected=setting(seed)['expected']
    for row in GRADED:
        value=expected[row]
        assert server.evaluate(row,value),row
        if isinstance(value,tuple):
            wrong=list(value);wrong[0]=not wrong[0] if SHAPES[row][0]=='bool' else wrong[0]+1
            assert not server.evaluate(row,list(value)[:-1]),row
        else:wrong=value+1
        assert not server.evaluate(row,wrong),row
        assert not server.evaluate(row,None),row
        print('KILLED wrong submitted value for '+row)
    print(f'All {len(mutations)+len(GRADED)} mutations killed.')
    return 0


if __name__=='__main__':raise SystemExit(main())
