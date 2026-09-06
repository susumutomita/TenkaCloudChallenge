"""Linux process/grade regressions. Uses synthetic inputs; never prints hidden data."""
from __future__ import annotations

import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import run_functions, public_diagnostic
from participant.public_checks import check as public_check
from fixtures.generate import public_payload
from verifier import server
from verifier.values import Values
from tests.hidden import check_sharing

REFERENCE = (ROOT/'reference/sharing.py').read_text()


@unittest.skipUnless(sys.platform=='linux','requires the deployed Linux seccomp boundary')
class Boundary(unittest.TestCase):
    def test_reference_all_code_checkpoints_and_public_checks(self):
        for seed in ('boundary-one','boundary-two'):
            with patch.object(server,'SEED',seed):
                for checkpoint in server.CODE_CHECKPOINTS:
                    self.assertTrue(server.evaluate(checkpoint,REFERENCE),checkpoint)
            self.assertTrue(public_check(REFERENCE,public_payload(seed))['passed'])

    def test_stdout_is_not_a_verdict_and_checker_not_importable(self):
        for source in (
            'import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
            'from tests.hidden import check_sharing\ncheck_sharing.run=lambda *args: []',
            'import sys\nsys.modules["fixtures.generate"].setting=lambda *args:{}',
            'import os\nprint(\'{"results": [{"value":true}]}\',flush=True)\nos._exit(0)',
        ):
            for checkpoint in server.CODE_CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(public_check(source,public_payload('boundary-negative'))['passed'])

    def test_worker_has_no_seed_checker_private_files_network_or_exec(self):
        source = '''import os,sys,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def share(pids):
    paths=['/problem/fixtures/generate.py','/problem/tests/hidden/check_sharing.py',
           '/problem/reference/sharing.py','/proc/self/environ','/proc/self/cmdline']
    paths += ['/proc/'+pid+'/'+name for pid in pids for name in ('environ','cmdline','mem')]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0: readable=True; os.close(fd)
    fd=libc.socket(2,1,0)
    network=fd>=0
    if network: os.close(fd)
    try: os.execv('/bin/true',['/bin/true']); executable=True
    except OSError: executable=False
    return {'seed': 'FLAG_SEED' in os.environ, 'private_read':readable,
            'network':network,'exec':executable,
            'checker':any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)}
'''
        pids=[p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        result=run_functions(source,[{'fn':'share','args':[pids]}])
        self.assertEqual(result['results'],[{'value':dict(seed=False,private_read=False,
                         network=False,exec=False,checker=False)}])

    def test_same_uid_cannot_change_or_signal_supervisor(self):
        source='''import os,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def share():
    pid=os.getppid()
    class Limit(ctypes.Structure): _fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    return [libc.kill(pid,0)==-1,libc.prlimit64(pid,1,ctypes.byref(limit),None)==-1]
'''
        self.assertEqual(run_functions(source,[{'fn':'share','args':[]}])['results'],
                         [{'value':[True,True]}])

    def test_sharing_cannot_stash_secret_for_reconstruction(self):
        for stash in ('global','file'):
            if stash=='global':
                source=REFERENCE+'''
import builtins
def share_line(secret,p,randomness):
    builtins.known=secret
    return [[x,(secret+randomness[0]*x)%p] for x in (1,2,3)]
def reconstruct_line(points,p): return builtins.known
'''
            else:
                source=REFERENCE+'''
def share_line(secret,p,randomness):
    open('/tmp/sharing-stash','w').write(str(secret))
    return [[x,(secret+randomness[0]*x)%p] for x in (1,2,3)]
def reconstruct_line(points,p): return int(open('/tmp/sharing-stash').read())
'''
            self.assertFalse(server.evaluate('two-of-three',source))

    def test_public_syntax_and_init_errors_are_location_only_hidden_is_generic(self):
        for source,kind,line in (
            ('def share(:\n pass','SyntaxError',1),
            ('x=1\nraise RuntimeError("SENSITIVE_SENTINEL")','RuntimeError',2),
            ('\nmissing_name','NameError',2),
        ):
            result=public_check(source,public_payload('safe-errors'))
            self.assertFalse(result['passed'])
            self.assertEqual(result['output'],f'sharing.py:{line}: {kind}')
            ok,message=server.evaluate_with_message('share-and-reconstruct',source)
            self.assertFalse(ok)
            self.assertEqual(message,'sharing.py could not produce the required values')
            self.assertNotIn('SENSITIVE_SENTINEL',json.dumps([result,message]))
        self.assertEqual(public_diagnostic({'error':{'type':'arbitrary text','line':True}}),
                         'sharing.py: Exception')

    def test_exception_and_stdout_cannot_return_hidden_call_inputs(self):
        source='''def share(*args):
    print('SENSITIVE_SENTINEL:'+repr(args),flush=True)
    raise RuntimeError('SENSITIVE_SENTINEL:'+repr(args))
'''
        ok,message=server.evaluate_with_message('share-and-reconstruct',source)
        self.assertFalse(ok)
        self.assertNotIn('SENSITIVE_SENTINEL',message or '')

    def test_success_and_timeout_reap_all_descendants_not_just_zombies(self):
        # Author/Compose commands run with --init/init:true. An orphan must disappear
        # from /proc altogether: a zombie is still a leaked PID, not success.
        source='''import os,time
def share(spin):
    pid=os.fork()
    if pid==0:
        while True: time.sleep(1)
    if spin:
        while True: time.sleep(1)
    return pid
'''
        before={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        result=run_functions(source,[{'fn':'share','args':[False]}],timeout=.5)
        pid=result['results'][0]['value']
        self.assertIsInstance(pid,int)
        timed=run_functions(source,[{'fn':'share','args':[True]}],timeout=.2)
        self.assertIsNone(timed)
        for _ in range(100):
            after={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
            if after <= before and not Path(f'/proc/{pid}').exists(): break
            time.sleep(.02)
        else: self.fail('learner descendant still exists, including zombie processes')

    def test_non_line_valid_sharing_remains_supported(self):
        # An independent two-of-three linear construction, not y=s+r*x.
        source=REFERENCE+'''
def share_line(secret,p,randomness):
    r=randomness[0]%p
    return [[1,(secret+r)%p],[2,r],[3,(secret+2*r)%p]]
def reconstruct_line(points,p):
    q=dict(points)
    if 1 in q and 2 in q:return (q[1]-q[2])%p
    if 2 in q and 3 in q:return (q[3]-2*q[2])%p
    return (2*q[1]-q[3])%p
'''
        self.assertTrue(server.evaluate('two-of-three',source))

    def test_threshold_accepts_only_canonical_json_integers(self):
        import copy
        cfg=public_payload(server.SEED)
        p,n=cfg['params']['p'],cfg['params']['n']
        partial=[0]*(n-1)
        valid={'sharesNeeded':n,'partial':partial,
               'completions':[{'secret':0,'lastShare':0},{'secret':1,'lastShare':1}]}
        self.assertTrue(server.evaluate('threshold',valid))
        for value in (float(n),str(n),True,None):
            bad=copy.deepcopy(valid);bad['sharesNeeded']=value
            self.assertFalse(server.evaluate('threshold',bad))
        for value in (0.0,0.5,'0',False,None,-p,p):
            for location in ('partial','secret','lastShare'):
                bad=copy.deepcopy(valid)
                if location=='partial':bad['partial'][0]=value
                else:bad['completions'][0][location]=value
                self.assertFalse(server.evaluate('threshold',bad),(location,type(value).__name__))
        for value in (None,[],{},[0,0]):
            bad=copy.deepcopy(valid);bad['completions'][0]=value
            self.assertFalse(server.evaluate('threshold',bad))

    def test_zero_randomness_and_zero_slope_are_valid(self):
        calls=[{'fn':'share','args':[4,3,7,[0,0]]},
               {'fn':'share_line','args':[1,7,[0]]},
               {'fn':'rerandomize','args':[[5,6,0],7,[0,0]]}]
        values=run_functions(REFERENCE,calls)['results']
        self.assertEqual(values,[{'value':[0,0,4]},{'value':[[1,1],[2,1],[3,1]]},
                                 {'value':[5,6,0]}])
        module=Values(REFERENCE,'zero-allowed',('check_no_trivial_split',))
        self.assertEqual(check_sharing.check_no_trivial_split(module,'zero-allowed'),[])


if __name__=='__main__': unittest.main()
