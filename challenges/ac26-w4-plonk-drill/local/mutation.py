"""Break arithmetic and construction rules; verify strict direct-answer parsing."""
import os,sys,types
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
os.environ['FLAG_SEED']='mutation-plonk'
from fixtures.generate import GRADED,setting
from participant.exercise import call_row
from tests.hidden.check_plonk_drill import run
from verifier import server
REFERENCE=(ROOT/'reference/plonk_drill.py').read_text()
MUTATIONS={
'skip gate remainder':('return u,u*u%p','return u,u*u'),
'keep stale output after changing input':('return l,u,l*u%p','return l,u,u*u%p'),
'confuse row with column':('w**r*tag%p','w**tag*r%p'),
'reverse the published copy cycle':('a[0],a[1],a[3],a[4],a[2],a[5]','a[0],a[1],a[4],a[2],a[3],a[5]'),
'omit mixing multiplier':('(n+beta*a+gamma)%p','(n+a+gamma)%p'),
'add instead of multiply':('left=left*x%p;right=right*y%p','left=(left+x)%p;right=(right+y)%p'),
'grade both sides as original':('return left,right','return left,left'),
'return unchanged row':('for l in range(p):','return rows[1]\n    for l in range(p):'),
'accept zero-product collision':('left==right and left!=0','left==right'),
'forget final multiplication':('answer=(l,r,l*r%p)','answer=(l,r,(l+r)%p)'),
}

def load(source):
    module=types.ModuleType('learner');exec(compile(source,'<author mutant>','exec'),module.__dict__);return module

def main():
    seeds=['mutation-plonk']+[f'case-{i}' for i in range(30)]
    reference=load(REFERENCE)
    for seed in seeds:assert not run(reference,seed)
    for name,(old,new) in MUTATIONS.items():
        assert old in REFERENCE,name
        mutant=load(REFERENCE.replace(old,new,1))
        assert any(run(mutant,seed) for seed in seeds),name
        print('KILLED',name)
    v=setting(server.SEED)['public']
    for row in GRADED:
        answer=tuple(call_row(reference,row,v))
        assert server.evaluate(row,answer),row
        assert server.evaluate(row,str(answer)),row
        for bad in [None,True,{},'oops',list(answer)+[0],list(answer)[:-1],[float(n) for n in answer],[str(n) for n in answer],[-1]*len(answer)]:
            assert not server.evaluate(row,bad),(row,bad)
    print('PASS 10 arithmetic/construction mutants and strict direct-answer parsing')

if __name__=='__main__':main()
