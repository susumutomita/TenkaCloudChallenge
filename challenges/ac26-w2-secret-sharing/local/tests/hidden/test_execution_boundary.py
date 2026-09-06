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

    def test_tuple_results_do_not_become_valid_lists(self):
        for name,checkpoint in (('share','share-and-reconstruct'),
                                ('rerandomize','rerandomize'),('share_line','two-of-three')):
            source=REFERENCE+f'\noriginal={name}\ndef {name}(*args):return tuple(original(*args))\n'
            self.assertFalse(server.evaluate(checkpoint,source),name)
            self.assertFalse(public_check(source,public_payload('boundary-types'))['passed'],name)
        for name in ('reconstruct','complete_shares','reconstruct_line'):
            result=run_functions(f'def {name}():return True',[{'fn':name,'args':[]}])
            self.assertIn('raised',result['results'][0],name)

    def test_initialization_cannot_read_calls_or_preprint_a_batch(self):
        names=('share','reconstruct','complete_shares','rerandomize','share_line','reconstruct_line')
        source=REFERENCE
        for name in names:source=source.replace('def '+name+'(', 'def _'+name+'(')
        source+='\nimport os,sys,json\npayload=sys._getframe(1).f_locals["payload"]\nresults=[{"value":globals()["_"+c["fn"]](*c["args"])} for c in payload["calls"]]\nprint(json.dumps({"results":results}),flush=True)\nos._exit(0)\n'
        for checkpoint in server.CODE_CHECKPOINTS:
            self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
        live='''import sys
initial_had_calls='calls' in sys._getframe(1).f_locals['payload']
def share():return [initial_had_calls,sys._getframe(1).f_locals['batch']['batchId']]
'''
        ids=[]
        for _ in range(2):
            value=run_functions(live,[{'fn':'share','args':[]}])['results'][0]['value']
            self.assertFalse(value[0])
            self.assertRegex(value[1],r'^[0-9a-f]{32}$')
            ids.append(value[1])
        self.assertNotEqual(*ids)

    def test_fixed_wrong_or_incomplete_batch_reply_is_rejected(self):
        for mode in ('fixed','wrong','eof'):
            source='import os,sys,json\nprint(\'{"ready":true}\',flush=True)\n'
            if mode=='fixed':
                source+='print(json.dumps({"batchId":"0"*32,"results":[{"value":0}]}),flush=True)\n'
            else:
                source+='batch=json.loads(sys.stdin.readline())\n'
                if mode=='wrong':
                    source+='print(json.dumps({"batchId":"wrong","results":[{"value":0}]}),flush=True)\n'
                else:
                    source+='print(json.dumps({"batchId":batch["batchId"],"results":[]}),flush=True)\n'
            source+='os._exit(0)\n'
            self.assertIsNone(run_functions(source,[{'fn':'share','args':[]}]),mode)

    def test_legal_zero_inputs_are_checked_by_actual_grader(self):
        reject_zero=REFERENCE+'''
_original_rerandomize=rerandomize
def rerandomize(shares,p,randomness):
    if all(r%p==0 for r in randomness):raise ValueError('reject zero')
    return _original_rerandomize(shares,p,randomness)
'''
        flat_wrong=REFERENCE+'''
_original_line=reconstruct_line
def reconstruct_line(points,p):
    if points[0][1]==points[1][1]:return 0
    return _original_line(points,p)
'''
        self.assertTrue(server.evaluate('rerandomize',REFERENCE))
        self.assertFalse(server.evaluate('rerandomize',reject_zero))
        self.assertTrue(server.evaluate('two-of-three',REFERENCE))
        self.assertFalse(server.evaluate('two-of-three',flat_wrong))

    def test_sysv_ipc_is_denied_and_no_objects_accumulate(self):
        source='''import ctypes
libc=ctypes.CDLL(None,use_errno=True)
libc.shmat.restype=ctypes.c_void_p
def share():
    calls=[('shmget',(0,4096,0o1600)),('shmat',(-1,None,0)),('shmdt',(None,)),('shmctl',(-1,0,None)),
           ('msgget',(0,0o1600)),('msgsnd',(-1,None,0,0)),('msgrcv',(-1,None,0,0,0)),('msgctl',(-1,0,None)),
           ('semget',(0,1,0o1600)),('semop',(-1,None,0)),('semtimedop',(-1,None,0,None)),('semctl',(-1,0,0))]
    result=[]
    for name,args in calls:
        ctypes.set_errno(0)
        value=getattr(libc,name)(*args)
        result.append([name,ctypes.get_errno()])
    return result
'''
        def objects():return {name:Path('/proc/sysvipc/'+name).read_text() for name in ('shm','msg','sem')}
        before=objects()
        result=run_functions(source,[{'fn':'share','args':[]}] * 64)
        for row in result['results']:
            self.assertEqual([code for name,code in row['value']],[1]*12)
        self.assertEqual(objects(),before)

    def test_partial_output_and_blocked_input_are_time_bounded(self):
        for source,calls in (
            ('import os\nos.write(1,b\'{"ready":\')\nwhile True:pass',[]),
            ('print(\'{"ready":true}\',flush=True)\nwhile True:pass',[{'fn':'share','args':['x'*200000]}]),
        ):
            started=time.monotonic()
            self.assertIsNone(run_functions(source,calls,timeout=.2))
            self.assertLess(time.monotonic()-started,3)

    def test_worker_has_no_seed_checker_private_files_network_or_exec(self):
        source = '''import os,sys,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def probe(pids):
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
        result=run_functions(source,[{'fn':'probe','args':[pids]}])
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
def probe(spin):
    pid=os.fork()
    if pid==0:
        while True: time.sleep(1)
    if spin:
        while True: time.sleep(1)
    return pid
'''
        before={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        result=run_functions(source,[{'fn':'probe','args':[False]}],timeout=.5)
        pid=result['results'][0]['value']
        self.assertIsInstance(pid,int)
        timed=run_functions(source,[{'fn':'probe','args':[True]}],timeout=.2)
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
