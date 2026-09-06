"""Real Linux isolation and parent-owned arithmetic checks; synthetic inputs only."""
from __future__ import annotations
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerError,LearnerSession
from participant.isolation import protect_supervisor
from participant.server import _WORKBENCH
from tests.public.test_beaver import run
from fixtures.generate import public_payload
from verifier import server

def reference():return (ROOT/'reference/beaver.py').read_text()

@unittest.skipUnless(sys.platform=='linux','requires deployed Linux isolation')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):protect_supervisor()

    def test_learner_cannot_change_supervisor_scheduling(self):
        before=(os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0))
        source="import os,ctypes\ndef mask():\n    libc=ctypes.CDLL(None,use_errno=True)\n    pid=os.getppid()\n    priority=ctypes.c_int(0)\n    calls=[('sched_setscheduler',(pid,5,ctypes.byref(priority))),\n           ('sched_setparam',(pid,ctypes.byref(priority))),\n           ('sched_setaffinity',(pid,0,None)),('setpriority',(0,pid,19))]\n    result=[]\n    for syscall,args in calls:\n        ctypes.set_errno(0)\n        value=getattr(libc,syscall)(*args)\n        result.append(int(value==-1 and ctypes.get_errno()==1))\n    return result\n"
        with LearnerSession({'beaver.py':source}) as learner:
            self.assertEqual(learner.call('beaver','mask',[]),[1,1,1,1])
        self.assertEqual((os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0)),before)

    def test_reference_all_checkpoints_and_public_examples(self):
        for seed in ('beaver-boundary-one','beaver-boundary-two'):
            with patch.object(server,'SEED',seed):
                for checkpoint in server.CHECKPOINTS:
                    self.assertTrue(server.evaluate(checkpoint,reference()),checkpoint)
            with LearnerSession({'beaver.py':reference()}) as learner:
                failures,output=run(learner.module(),public_payload(seed))
                self.assertEqual(failures,[],output)

    def test_mathematical_alternatives_and_in_place_inputs_are_accepted(self):
        alternatives=[reference()+"\ndef combine(c,a,b,d,e,p):\n    for i in range(len(c)):c[i]=(c[i]+d*b[i]+e*a[i])%p\n    c[-1]=(c[-1]+d*e)%p\n    return c\n",
                      reference()+"\ndef combine(c,a,b,d,e,p):\n    out=[(ci+d*bi+e*ai)%p for ci,ai,bi in zip(c,a,b)]\n    out[0]=(out[0]+d*e+1)%p\n    out[-1]=(out[-1]-1)%p\n    return out\n"]
        for source in alternatives:
            for checkpoint in server.CHECKPOINTS:
                self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
            self.assertTrue(_WORKBENCH.run_public_tests({'beaver.py':source})['passed'])
        # Zero openings and n=1 are valid arithmetic inputs even though the hidden
        # anti-mutation cases deliberately use nondegenerate values.
        with LearnerSession({'beaver.py':alternatives[0]}) as learner:
            self.assertEqual(learner.module().combine([5],[2],[6],0,4,7),[6])

    def test_stdout_exit_and_hidden_monkeypatch_do_not_grade(self):
        sources=['import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
                 'import os\nos._exit(0)',
                 'from tests.hidden import check_beaver\ncheck_beaver.run=lambda *args:[]']
        for source in sources:
            for checkpoint in server.CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(_WORKBENCH.run_public_tests({'beaver.py':source})['passed'])

    def test_preprinted_predictable_id_cannot_answer_a_no_argument_call(self):
        source='import os\nprint(\'{"ready":true}\',flush=True)\nprint(\'{"callId":1,"value":1}\',flush=True)\nos._exit(0)'
        learner=LearnerSession({'beaver.py':source})
        with learner:
            with self.assertRaises(LearnerError):learner.module().rounds()
        self.assertRegex(learner.sequence,r'^[0-9a-f]{32}$')

    def test_python_tuple_bool_and_float_types_do_not_change_through_json(self):
        for function,checkpoint in [('mask','mask'),('combine','combine')]:
            source=reference()+f'\noriginal={function}\ndef {function}(*args):return tuple(original(*args))\n'
            self.assertFalse(server.evaluate(checkpoint,source),function)
            self.assertFalse(server.evaluate('transfer',source))
            self.assertFalse(_WORKBENCH.run_public_tests({'beaver.py':source})['passed'])
        for value in ('True','1.0','2','0'):
            source=reference()+'\ndef rounds():return '+value+'\n'
            self.assertFalse(server.evaluate('protocol',source),value)
            self.assertFalse(server.evaluate('transfer',source),value)
            self.assertTrue(server.evaluate('combine',source),'independent checkpoint')

    def test_canonical_open_is_an_output_contract_even_when_residue_is_correct(self):
        source=reference()+'\ndef open_value(shares,p):return sum(shares)\n'
        self.assertFalse(server.evaluate('open',source))
        # The combined residue can still be correct; do not teach otherwise.
        with LearnerSession({'beaver.py':source}) as learner:
            module=learner.module()
            self.assertEqual(sum(module.combine([4,2,6],[1,2,6],[2,3,1],10,11,7))%7,1)

    def test_public_example_catches_repeated_product_and_cross_term_swap(self):
        for tail in ('return [(ci+d*bi+e*ai+d*e)%p for ci,ai,bi in zip(c,a,b)]',
                     'out=[(ci+d*ai+e*bi)%p for ci,ai,bi in zip(c,a,b)];out[0]=(out[0]+d*e)%p;return out'):
            source=reference()+'\ndef combine(c,a,b,d,e,p):'+tail+'\n'
            self.assertFalse(_WORKBENCH.run_public_tests({'beaver.py':source})['passed'])
            self.assertFalse(server.evaluate('combine',source))

    def test_persistent_ipc_syscalls_are_denied_without_residual_objects(self):
        paths=[Path('/proc/sysvipc')/name for name in ('shm','msg','sem')]
        before=[path.read_text() for path in paths]
        source="""import ctypes
        """+'\ndef mask():\n    libc=ctypes.CDLL(None,use_errno=True)\n    calls=[("shmget",(0,4096,0o1600)),("shmat",(-1,None,0)),("shmdt",(None,)),("shmctl",(-1,0,None)),("msgget",(0,0o1600)),("msgsnd",(-1,None,0,0)),("msgrcv",(-1,None,0,0,0)),("msgctl",(-1,0,None)),("semget",(0,1,0o1600)),("semop",(-1,None,0)),("semtimedop",(-1,None,0,None)),("semctl",(-1,0,0))]\n    out=[]\n    for name,args in calls:\n        ctypes.set_errno(0)\n        result=getattr(libc,name)(*args)\n        out.append(int(result==-1 and ctypes.get_errno()==1))\n    return out\n'
        for _ in range(16):
            with LearnerSession({'beaver.py':source}) as learner:
                self.assertEqual(learner.call('beaver','mask',[]),[1]*12)
        self.assertEqual([path.read_text() for path in paths],before)

    def test_all_process_environment_private_files_network_exec_are_denied(self):
        source="""import ctypes,os,sys
def mask(pids):
    libc=ctypes.CDLL(None,use_errno=True)
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py','/problem/tests/hidden/check_beaver.py']+['/proc/'+p+'/environ' for p in pids]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0:readable=True;os.close(fd)
    try:os.execv('/bin/true',['/bin/true']);executed=True
    except OSError:executed=False
    return [int('FLAG_SEED' in os.environ),int(readable),int(libc.socket(2,1,0)>=0),int(executed),int(any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules))]
"""
        pids=[p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        with LearnerSession({'beaver.py':source}) as learner:
            self.assertEqual(learner.call('beaver','mask',[pids]),[0]*5)

    def test_parent_signals_resource_limits_and_inherited_fds(self):
        source="""import ctypes,os
def mask(fd):
    libc=ctypes.CDLL(None,use_errno=True)
    class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    try:os.fstat(fd);inherited=True
    except OSError:inherited=False
    return [int(libc.kill(os.getppid(),0)==-1),int(libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1),int(inherited)]
"""
        with open('/dev/null') as handle:
            os.set_inheritable(handle.fileno(),True)
            with LearnerSession({'beaver.py':source}) as learner:
                self.assertEqual(learner.call('beaver','mask',[handle.fileno()]),[1,1,0])

    def test_partial_output_timeout_and_descendant_cleanup(self):
        source="""import os
def rounds():
    pid=os.fork()
    if pid==0:
        while True:pass
    return pid
def open_value():
    os.write(1,b'{"callId":')
    while True:pass
"""
        # Establish the worker before the short hang deadline. Starting Python
        # on a loaded Docker host is not the behavior this test measures.
        with LearnerSession({'beaver.py':source},timeout=5) as learner:
            pid=learner.module().rounds()
            start=time.monotonic()
            learner.deadline=start+.3
            with self.assertRaises(LearnerError):learner.call('beaver','open_value',[])
        self.assertLess(time.monotonic()-start,3)
        for _ in range(200):
            if not Path(f'/proc/{pid}').exists():break
            time.sleep(.01)
        else:self.fail('forked descendant not reaped')
        self.assertTrue(server.evaluate('transfer',reference()))

    def test_repeated_forks_leave_no_live_or_zombie_descendants(self):
        source=reference()+'\nimport os\nfor _ in range(4):\n    if os.fork()==0:os._exit(0)\n'
        baseline={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        for attempt in range(64):
            self.assertTrue(server.evaluate('mask',source),attempt)
            for _ in range(200):
                extra={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}-baseline
                if not extra:break
                time.sleep(.01)
            self.assertEqual(extra,set(),f'unreaped processes after {attempt+1}')

    def test_diagnostics_are_source_location_only_and_hidden_feedback_is_generic(self):
        for source,line,kind in [('def bad(:\n',1,'SyntaxError'),
                                 ('# one\nimport missing_learner_module\n',2,'ModuleNotFoundError'),
                                 ('# one\nraise ValueError("DO_NOT_EXPOSE")\n',2,'ValueError')]:
            self.assertEqual(_WORKBENCH.run_public_tests({'beaver.py':source}),{'passed':False,'output':f'beaver.py:{line}: {kind}'})
            correct,message=server.evaluate_with_message('mask',source)
            self.assertFalse(correct)
            self.assertNotIn(kind,message)
            self.assertNotIn('DO_NOT_EXPOSE',message)

    def test_hidden_input_prints_are_not_feedback(self):
        source='def mask(a,b,p):\n    print("HIDDEN:"+str(a),flush=True)\n    raise ValueError("HIDDEN:"+str(a))\n'
        correct,message=server.evaluate_with_message('mask',source)
        self.assertFalse(correct)
        self.assertNotIn('HIDDEN',message)

    def test_output_overflow_and_deep_json_fail_closed(self):
        for source in ('print("["*2000+"0"+"]"*2000,flush=True)\nwhile True:pass',
                       'print("x"*70000,flush=True)\nwhile True:pass'):
            learner=LearnerSession({'beaver.py':source},timeout=.2)
            with self.assertRaises(LearnerError):
                with learner:pass
            self.assertIsNotNone(learner.process.returncode)
            self.assertFalse(Path(f'/proc/{learner.process.pid}').exists())

    def test_all_existing_tcw1_code_seals_and_binding(self):
        prepared=_WORKBENCH.prepare_submissions({'beaver.py':reference()},{})
        for checkpoint in server.CHECKPOINTS:
            sealed=prepared['submissions'][checkpoint]
            self.assertTrue(sealed.startswith('tcw1.'))
            self.assertTrue(server.evaluate(checkpoint,server._unwrap_submission(checkpoint,sealed)))
            other=next(item for item in server.CHECKPOINTS if item!=checkpoint)
            self.assertIsNone(server._unwrap_submission(other,sealed))
            with patch.object(server,'SEED','another-synthetic-deployment'):
                self.assertIsNone(server._unwrap_submission(checkpoint,sealed))
            # The pre-existing raw-source code contract remains accepted.
            self.assertTrue(server.evaluate(checkpoint,reference()))

if __name__=='__main__':unittest.main()
