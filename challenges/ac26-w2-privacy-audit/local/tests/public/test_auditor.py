"""Public examples from the statement, checked in the trusted parent.

These examples illustrate the rules; passing them is not a full privacy proof.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerError, LearnerSession
from participant.isolation import protect_supervisor
SEED=os.environ.get('FLAG_SEED','local-dev-seed')

def _load_public_evidence() -> dict:
    """This deployment's specification and the one clean run's trace -- what `show.py`
    prints, and the only two things this file has ever needed.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module's `TRUTH` names the verdict for each of the seven programs by
    id, and it shipped in the same image as `tests/hidden/check_auditor.py`, whose
    `_expected_index` and `_leaks` state the decision rule `first_violation` exists to
    make a learner derive -- so it does not ship in the `participant` Docker stage at all
    any more (see ../../Dockerfile). This deployment's own verifier is the only source
    for the public half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched
    it, or `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.request import urlopen

        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Neither is set: this only resolves when `fixtures/` is actually on disk, which is
    # true for a checkout (this file run directly, e.g. by
    # scripts/ac26-w2-privacy-audit.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


SMALL={'p':7,'parties':['A','B','C'],'publicInputs':['u','v','w'],'masked':['d'],'result':'T'}


def event(kind, label='', party='', owner='', value=0, text=''):
    return dict(kind=kind,label=label,party=party,owner=owner,value=value,text=text)


def run_cases(module, public, only=''):
    def allowed():
        got=module.allowed_opens(dict(public['spec']))
        sp=public['spec']
        assert isinstance(got,list) and got==sorted({*sp['publicInputs'],*sp['masked'],sp['result']}), 'return the sorted permitted names, each once'
    def clean():
        assert module.first_violation(list(public['cleanEvents']),dict(public['spec'])) is None, 'a clean run must return None'
    def first_open():
        got=module.first_violation([event('open','d'),event('emit','w'),event('open','S')],SMALL)
        assert isinstance(got,dict) and got.get('kind')=='opened-a-secret' and type(got.get('index')) is int and got['index']==2, 'the first extra opening is at position 2'
    def own_and_other():
        trace=[event('peek',party='A',owner='A'),event('peek',party='A',owner='B')]
        assert module.first_violation(trace,SMALL)=={'kind':'cross-party-read','index':1}, 'reading your own storage is permitted; the next event is not'
    def messages():
        for kind,reason in [('emit','leaked-in-log'),('fail','leaked-in-error')]:
            trace=[event(kind,'w'),event(kind,'S')]
            assert module.first_violation(trace,SMALL)=={'kind':reason,'index':1}, 'check the name, not whether a message exists'
    def recovery():
        transcript=[{'label':k,'value':v} for k,v in [('u',1),('v',2),('w',3),('d',1),('T',2),('S',4)]]
        got=module.derive_secret(transcript,SMALL)
        assert isinstance(got,dict) and got.get('party')=='C' and type(got.get('value')) is int and got['value']==4, 'p=7: (2-4)*inverse(3) has remainder 4'
    def repair():
        ops=[('open','d'),('emit','S','debug'),('output','T')]
        got=module.repair(ops,SMALL)
        assert isinstance(got,list) and json.loads(json.dumps(got))==[['open','d'],['output','T']], 'remove only emit S, keeping the two other operations'
    def rename():
        sp=dict(SMALL,masked=['m'])
        trace=[event('open','q'),event('open','m')]
        assert module.first_violation(trace,sp)=={'kind':'opened-a-secret','index':0}, 'use the new allowed names and recount from zero'
    cases=[('allowed-names',allowed),('clean-run',clean),('first-open',first_open),('own-and-other',own_and_other),('logs-and-errors',messages),('recovery-p7',recovery),('repair-keeps-permitted',repair),('renamed-position',rename)]
    lines=[];failed=0;selected=0
    for name,fn in cases:
        if only and only not in name:continue
        selected+=1
        try:fn();lines.append('PASS '+name)
        except AssertionError as error:failed+=1;lines.append('FAIL '+name+': '+str(error))
        except Exception as error:failed+=1;lines.append('FAIL '+name+': '+type(error).__name__)
    if not selected:return False,'No public test matched '+repr(only)
    lines.append('public tests: '+('all passed' if not failed else str(failed)+' failed'))
    return not failed,'\n'.join(lines)


def main(argv):
    protect_supervisor()
    only=argv[argv.index('--only')+1] if '--only' in argv else ''
    directory=Path(os.environ.get('SUBMISSION_DIR',str(ROOT/'starter')))
    sources={'auditor.py':(directory/'auditor.py').read_text()}
    learner=LearnerSession(sources)
    try:
        public=_load_public_evidence()
        with learner:passed,output=run_cases(learner.module(),public,only)
        print(output)
        return 0 if passed else 1
    except (LearnerError,OSError,ValueError):
        print(learner.initialization_diagnostic or 'The submitted functions could not be evaluated.')
        return 1


if __name__=='__main__':raise SystemExit(main(sys.argv[1:]))
