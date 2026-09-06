"""Each wrong arithmetic rule must fail, including strict direct-answer parsing."""
import json,os,sys,types
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
os.environ['FLAG_SEED']='mutation-suite-seed'
from fixtures.generate import GRADED,setting
from verifier.expected import expected_for
from verifier import server
from tests.hidden.check_fri_drill import run
REFERENCE=(ROOT/'reference/fri_drill.py').read_text()
MUTATIONS={
 'coefficients instead of values': ('return tuple(q(qs,t,p) for t in (0,1,2))','return qs[:3]'),
 'forget fold multiplier': ('folded(qs,beta,t,p)','folded(qs,1,t,p)'),
 'repeat first beta': ('(c+beta2*d)%p','(c+beta*d)%p'),
 'read same point twice': ('q(qs,-x,p))','q(qs,x,p))'),
 'divide by x not 2x': ('inverse(2*x,p)','inverse(x,p)'),
 'compare wrong position': ('folded(qs,beta,x*x,p))','folded(qs,beta,x,p))'),
 'omit slope of alteration': ('(right+d0+d1*x*x)%p','(right+d0)%p'),
 'use positions instead of squares': ('r=t*t%p','r=t%p'),
 'allow an honest first expression': ('((-x*x)%p,1,*coefficients)','(0,0,*coefficients)'),
 'choose first lie before seeing x': ('((-x*x)%p,1,*coefficients)','(p-1,1,*coefficients)'),
 'forget one square constraint': ('for r in squares:','for r in squares[:1]:'),
 'zero second expression': ('((-x*x)%p,1,*coefficients)','((-x*x)%p,1,0,0,0,0)'),
}


def load(source):
    module=types.ModuleType('learner');exec(compile(source,'<author mutant>','exec'),module.__dict__);return module


def main():
    seeds=['mutation-suite-seed','alpha','beta','gamma']
    for seed in seeds:
        assert not run(load(REFERENCE),seed)
    for name,(old,new) in MUTATIONS.items():
        assert old in REFERENCE,name
        mutant=load(REFERENCE.replace(old,new,1))
        assert any(run(mutant,seed) for seed in seeds),name
        print('KILLED',name)
    answers=expected_for(server.SEED)
    for row in GRADED:
        value=answers[row]
        assert server.evaluate(row,value),row
        assert server.evaluate(row,str(value)),row
        wrong=(value+1) if type(value) is int else tuple(n+1 for n in value)
        assert not server.evaluate(row,wrong),row
        malformed=[True,None,{},[1.1], 'not a number']
        malformed += [float(value),str(float(value))] if type(value) is int else [list(value)+[0],list(value)[:-1],[float(n) for n in value],[str(n) for n in value]]
        for bad in malformed:
            assert not server.evaluate(row,bad),(row,bad)
    print('PASS 12 arithmetic/construction mutants; all correct shapes and malformed-answer checks')


if __name__=='__main__':main()
