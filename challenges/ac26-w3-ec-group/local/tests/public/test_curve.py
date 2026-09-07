"""Small public examples, checked outside the submitted Python process."""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerSession
from participant.isolation import protect_supervisor
SEED=os.environ.get('FLAG_SEED','local-dev-seed')

def _load_public_evidence() -> dict:
    """This deployment's curve and its affine points -- what `show.py` prints, and what
    this file has always handed to `Curve(p, a, b)`.

    Issue 537/538 (Issue 543 option B2): this file used to import `fixtures.generate`
    directly. That module derives the curve, the sample points and the scalars every
    checkpoint is graded against, and it shipped in the same image as
    `tests/hidden/check_curve.py`, whose `_ReferenceCurve` is a complete group law --
    so neither ships in the `participant` Docker stage any more (see ../../Dockerfile).
    This deployment's own verifier is the only source for the public half now:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, or
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
    # scripts/ac26-w3-ec-group.test.ts) and the verifier/author Docker stages, and never
    # inside a built `participant` image -- so this branch does not reopen the leak
    # above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def run_cases(module, public, only=''):
    def coordinates(point):
        return None if point.is_infinity else (point.x, point.y)

    def membership():
        c=module.Curve(7,1,0)
        if not c.contains(module.Point(c,1,3)) or c.contains(module.Point(c,1,1)):
            return 'membership must follow the remainder equation'
        try: c.point(1,1)
        except module.NotOnCurve: pass
        else: return 'an off-curve point must raise NotOnCurve'
        return ''

    def identity():
        c=module.Curve(7,1,0);p=c.point(1,3);o=c.infinity();z=c.point(0,0)
        if z.is_infinity or z==o or coordinates(o+p)!=(1,3) or coordinates(p+o)!=(1,3):
            return 'O and (0,0) have different roles'
        if coordinates(-p)!=(1,4) or not (p+(-p)).is_infinity:
            return 'opposite points must add to O'
        return ''

    def addition():
        c=module.Curve(7,1,0)
        return '' if coordinates(c.point(1,3)+c.point(3,3))==(3,4) else 'the two-point sum is wrong'

    def doubling():
        c=module.Curve(7,1,0);p=c.point(1,3)
        if coordinates(p+p)!=(0,0) or not (c.point(0,0)+c.point(0,0)).is_infinity:
            return 'doubling must distinguish a nonzero y from y=0'
        return ''

    def scalar():
        c=module.Curve(7,1,0);p=c.point(1,3)
        for k,want in ((0,None),(2,(0,0)),(4,None),(5,(1,3)),(-1,(1,4))):
            if any(coordinates(q)!=want for q in (p.scalar_mul(k),k*p,p*k)):
                return 'scalar multiplication does not follow repeated group addition'
        return ''

    def trace():
        c=module.Curve(7,1,0);p=c.point(1,3)
        expected=[]
        for i,(bit,before,after,doubled) in enumerate(((1,'(1, 3)','(1, 3)','(0, 0)'),(0,'(0, 0)','(1, 3)','O'),(1,'O','(1, 3)','O'))):
            expected.append(dict(index=i,bit=bit,accumulator_before='O' if i==0 else '(1, 3)',addend_before=before,added=bool(bit),accumulator_after=after,addend_after=doubled,on_curve=True))
        rows=module.double_and_add_trace(p,5)
        if rows!=expected or module.double_and_add_trace(p,0)!=[]:
            return 'the trace must record each before/after row and use no rows for zero'
        if any(type(row.get(k)) is not int for row in rows for k in ('index','bit')) or any(type(row.get(k)) is not bool for row in rows for k in ('added','on_curve')):
            return 'trace indices and bits are integers; flags are booleans'
        return ''

    def equivalent_curves():
        c=module.Curve(7,1,0);d=module.Curve(7,1,0);p=c.point(1,3);q=d.point(1,3)
        if p!=q or hash(p)!=hash(q) or coordinates(p+q)!=(0,0):
            return 'equal curve settings must work across separate instances'
        try: p+module.Curve(7,0,1).infinity()
        except module.CurveMismatch: pass
        else: return 'different curve settings must raise CurveMismatch'
        return ''

    def deployment_points():
        params=public['params'];c=module.Curve(params['p'],params['a'],params['b'])
        for x,y in public['points'][:4]:
            if coordinates(c.point(x,y))!=(x,y) or not c.contains(module.Point(c,x,y)):
                return 'the displayed deployment points must be recognized'
        return ''

    checks=[('point-membership',membership),('identity-and-opposite',identity),
            ('two-different-points',addition),('doubling-and-zero-y',doubling),
            ('signed-scalars',scalar),('each-trace-row',trace),
            ('curve-equality-and-mismatch',equivalent_curves),('deployment-points',deployment_points)]
    failures=[];lines=[]
    for name, check in checks:
        if only and only not in name: continue
        try: failure=check()
        except Exception: failure='the submitted operation did not satisfy this public rule'
        if failure: failures.append(failure)
        lines.append(f'FAIL {name}: {failure}' if failure else f'ok   {name}')
    lines.append(f'public tests: {len(failures)} failed' if failures else 'public tests: all passed')
    lines.append('Small examples only: passing these does not prove the unseen curves or 256-bit cases.')
    return failures,'\n'.join(lines)


def main(argv):
    protect_supervisor()
    source=(Path(os.environ.get('SUBMISSION_DIR',str(ROOT/'starter')))/'curve.py').read_text()
    public=_load_public_evidence()
    only=argv[argv.index('--only')+1] if '--only' in argv else ''
    session=LearnerSession({'curve.py':source})
    try:
        with session: failures,output=run_cases(session.module(),public,only)
        print(output)
        return int(bool(failures))
    except Exception:
        print('Public tests could not complete.')
        if session.initialization_diagnostic: print(session.initialization_diagnostic)
        return 1


if __name__=='__main__':
    raise SystemExit(main(sys.argv[1:]))
