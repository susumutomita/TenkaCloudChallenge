"""Public examples: negative inputs, small arithmetic, a trace, inverse and exceptions.

The same trusted checks run in the Portal and this CLI. Source runs in an isolated
worker; printed success messages cannot replace returned mathematical values.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant.execution import LearnerSession
SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

def _load_public_evidence() -> dict:
    """This deployment's moduli -- what `show.py` prints.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module implements `egcd` under the exact name the starter's own stub
    asks the learner to write, and `egcd_rows` supplies the trace its `egcd_trace` stub
    asks for, so it does not ship in the `participant` Docker stage at all any more (see
    ../../Dockerfile). This deployment's own verifier is the only source for the public
    half now: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # scripts/ac26-w3-field-inverse.test.ts) and the verifier/author Docker stages, and
    # never inside a built `participant` image -- so this branch does not reopen the
    # leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)



def _element(e, expected, m):
    return (type(e.value) is int and e.value == expected and
            type(e.field.modulus) is int and e.field.modulus == m)


def run_cases(submission, public, only=''):
    p = public['primeModulus']

    def canonical():
        f = submission.Field(p)
        for raw in (0, 1, p, p+1, -1):
            x, y = f.element(raw), submission.Field(p).element(raw+p)
            if not _element(x, raw % p, p) or x != y or hash(x) != hash(y):
                return 'the remainder, equality or hash does not follow normalization'
            if x == submission.Field(p+1).element(x.value):
                return 'equality ignored the modulus'
        return ''

    def arithmetic():
        f = submission.Field(p); a, b = f.element(6), f.element(7)
        return '' if _element(a+b, 13%p, p) and _element(a*b, 42%p, p) else 'addition or multiplication is wrong'

    def one_inverse():
        x = submission.Field(p).element(6); inv = x.inverse()
        return '' if _element(inv, pow(6,-1,p), p) else 'the inverse does not multiply to remainder one'

    def small_arithmetic():
        f = submission.Field(7); a,b=f.element(5),f.element(4)
        return '' if all(_element(x,v,7) for x,v in ((a+b,2),(a-b,1),(a*b,6))) else 'modulus seven arithmetic is wrong'

    def trace():
        triple = submission.egcd(3,7)
        rows = submission.egcd_trace(3,7)
        if not isinstance(triple,(list,tuple)) or len(triple)!=3 or any(type(x) is not int for x in triple) or list(triple)!=[1,-2,1]:
            return 'egcd does not return the signed coefficients'
        want = [{'q':0,'r':7,'s':0,'t':1}, {'q':2,'r':3,'s':1,'t':0}, {'q':3,'r':1,'s':-2,'t':1}]
        if not isinstance(rows,(list,tuple)) or len(rows)!=3 or any(not isinstance(row,dict) or any(type(row.get(k)) is not int for k in ('q','r','s','t')) for row in rows) or list(rows)!=want:
            return 'the trace must contain every integer row in order'
        return ''

    def small_inverse():
        f = submission.Field(7); a,b=f.element(4),f.element(3)
        return '' if _element(b.inverse(),5,7) and _element(a/b,6,7) else 'inverse or division under seven is wrong'

    def errors():
        f,g = submission.Field(7),submission.Field(6)
        for call in (lambda:f.element(0).inverse(),lambda:f.element(3)/f.element(0)):
            try: call()
            except submission.NotInvertible: pass
            else: return 'zero has no inverse and must raise NotInvertible'
        for call in (lambda x,y:x+y,lambda x,y:x-y,lambda x,y:x*y,lambda x,y:x/y):
            try: call(f.element(3),g.element(3))
            except submission.FieldMismatch: pass
            else: return 'mixed moduli must raise FieldMismatch in every arithmetic operation'
        return ''

    checks = [('elements-are-canonical',canonical),('arithmetic-on-small-values',arithmetic),
              ('inverse-of-one-element',one_inverse),('small-seven-arithmetic',small_arithmetic),
              ('small-euclid-trace',trace),('small-seven-inverse',small_inverse),
              ('zero-and-mixed-moduli',errors)]
    failures, transcript = [], []
    for name, check in checks:
        if only and only not in name: continue
        try: failure = check()
        except Exception: failure = 'the submitted operation did not satisfy this public rule'
        if failure:
            failures.append(failure);transcript.append(f'FAIL {name}: {failure}')
        else: transcript.append(f'ok   {name}')
    transcript.append(f'public tests: {len(failures)} failed' if failures else 'public tests: all passed')
    transcript.append('These public examples do not exhaust the unseen moduli.')
    return failures, '\n'.join(transcript)


def main(argv):
    source = (Path(os.environ.get('SUBMISSION_DIR', str(ROOT/'starter')))/'field.py').read_text()
    evidence = _load_public_evidence()
    only = argv[argv.index('--only')+1] if '--only' in argv else ''
    session = LearnerSession({'field.py': source})
    try:
        with session:
            failures, output = run_cases(session.module(), evidence, only)
        print(output)
        return int(bool(failures))
    except Exception:
        print('Public tests could not complete.')
        if session.initialization_diagnostic: print(session.initialization_diagnostic)
        return 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
