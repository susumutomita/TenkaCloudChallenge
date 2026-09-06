"""Six public checks over untrusted JSON values; no submission import in this process."""
from __future__ import annotations

import time
from participant.execution import public_diagnostic, run_functions


def check(source, public):
    deadline = time.monotonic() + 12
    def run(calls):
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            return None
        return run_functions(source,calls,timeout=remaining)
    p,n,s = public['params']['p'],public['params']['n'],public['secret']
    initial = run([{'fn':'share','args':[s,n,p,public['shareRandomness']]},
                   {'fn':'share_line','args':[s,p,public['lineRandomness']]}])
    if not isinstance(initial,dict) or 'results' not in initial:
        return {'passed':False,'output':public_diagnostic(initial)}
    result = initial['results']
    for item in result:
        if 'raised' in item:
            return {'passed':False,'output':public_diagnostic({'error':item['raised']})}
    shares,points = (r.get('value') for r in result)
    checks = {
        'share_returns_one_value_per_party':isinstance(shares,list) and len(shares)==n,
        'shares_are_field_elements':isinstance(shares,list) and
            all(type(v) is int and 0 <= v < p for v in shares),
        'share_line_returns_three_points_at_x_1_2_3':isinstance(points,list) and
            len(points)==3 and all(isinstance(point,list) and len(point)==2 and
            type(point[0]) is int and point[0]==i and type(point[1]) is int and
            0 <= point[1] < p for i,point in enumerate(points,1)),
    }
    if all(checks.values()):
        next_result = run([{'fn':'reconstruct','args':[shares,p]},
                           {'fn':'rerandomize','args':[shares,p,public['rerandomizationRandomness']]},
                           {'fn':'reconstruct_line','args':[points[:2],p]}])
        if not isinstance(next_result,dict) or 'results' not in next_result:
            return {'passed':False,'output':public_diagnostic(next_result)}
        for item in next_result['results']:
            if 'raised' in item:
                return {'passed':False,'output':public_diagnostic({'error':item['raised']})}
        recovered,fresh,line = (r.get('value') for r in next_result['results'])
        checks.update({
            'the_full_set_reconstructs_the_secret':type(recovered) is int and recovered==s%p,
            'rerandomize_returns_one_value_per_party':isinstance(fresh,list) and len(fresh)==n,
            'two_points_of_the_line_walk_back_to_the_secret':type(line) is int and line==s%p,
        })
    output = '\n'.join(('PASS ' if ok else 'FAIL ')+name for name,ok in checks.items())
    output += '\nPublic tests check shapes and reconstruction; passing does not prove privacy.'
    return {'passed':all(checks.values()),'output':output}
