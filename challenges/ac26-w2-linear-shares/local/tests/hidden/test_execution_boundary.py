"""Actual Linux value-channel regressions. All inputs/seeds in this suite are synthetic."""
from __future__ import annotations

import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant.execution import LearnerError, LearnerSession
from participant.isolation import protect_supervisor
from participant.server import _WORKBENCH
from tests.public.test_linear import run_cases
from fixtures.generate import public_payload, OPERATION_ROUNDS, operations
from verifier import server


def reference():
    return (ROOT / 'reference/linear.py').read_text()


def zombies():
    found=[]
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            if path.read_text().rsplit(')',1)[1].split()[0]=='Z':found.append(path.parent.name)
        except (FileNotFoundError,ProcessLookupError):pass
    return found


@unittest.skipUnless(sys.platform=='linux','requires deployed Linux isolation')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_learner_cannot_change_supervisor_scheduling(self):
        before=(os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0))
        source="import os,ctypes\ndef probe():\n    libc=ctypes.CDLL(None,use_errno=True)\n    pid=os.getppid()\n    priority=ctypes.c_int(0)\n    calls=[('sched_setscheduler',(pid,5,ctypes.byref(priority))),\n           ('sched_setparam',(pid,ctypes.byref(priority))),\n           ('sched_setaffinity',(pid,0,None)),('setpriority',(0,pid,19))]\n    result=[]\n    for syscall,args in calls:\n        ctypes.set_errno(0)\n        value=getattr(libc,syscall)(*args)\n        result.append(int(value==-1 and ctypes.get_errno()==1))\n    return result\n"
        with LearnerSession({'linear.py':source}) as learner:
            self.assertEqual(learner.call('linear','probe',[]),[1,1,1,1])
        self.assertEqual((os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0)),before)

    def test_reference_and_public_examples(self):
        for seed in ('boundary-one','boundary-two'):
            with patch.object(server,'SEED',seed):
                for checkpoint in server.CODE_CHECKPOINTS:
                    self.assertTrue(server.evaluate(checkpoint,reference()),checkpoint)
            with LearnerSession({'linear.py':reference()}) as learner:
                passed,output=run_cases(learner.module(),public_payload(seed))
                self.assertTrue(passed,output)

    def test_stdout_cannot_forge_grades_or_public_success(self):
        for source in ('import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
                       'import os\nprint(\'{"callId":1,"value":0}\',flush=True)\nos._exit(0)',
                       'from tests.hidden import check_linear\ncheck_linear.run=lambda *args:[]'):
            for checkpoint in server.CODE_CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(_WORKBENCH.run_public_tests({'linear.py':source})['passed'])

    def test_negative_rounds_rejected_but_positive_counts_accepted(self):
        for count in (-1,True,1.5):
            source=reference()+'\ndef communication_rounds(operation):\n    return 0 if operation in '+repr([k for k,v in OPERATION_ROUNDS.items() if v==0])+f' else {count!r}\n'
            self.assertFalse(server.evaluate('transfer',source),count)
            self.assertTrue(server.evaluate('add-shares',source),'separate checkpoints stay independent')
        source=reference()+'\ndef communication_rounds(operation):\n    return 0 if operation in '+repr([k for k,v in OPERATION_ROUNDS.items() if v==0])+' else 2\n'
        self.assertTrue(server.evaluate('transfer',source))

    def test_list_and_tuple_sequences_have_the_same_verdict(self):
        for function,checkpoint in (('add_shares','add-shares'),
                                    ('add_constant','add-constant'),
                                    ('mul_constant','mul-constant')):
            source=reference()+f'\noriginal={function}\ndef {function}(*args):return tuple(original(*args))\n'
            self.assertTrue(server.evaluate(checkpoint,source),function)
            self.assertTrue(server.evaluate('transfer',source),function)
            self.assertTrue(_WORKBENCH.run_public_tests({'linear.py':source})['passed'],function)

    def test_live_reply_values_still_require_the_parent_mathematical_checks(self):
        mutations={'correct':'value',
                   'wrong sum':'[(value[0]+1)%p,*value[1:]]',
                   'wrong length':'value[:-1]',
                   'boolean':'[True,*value[1:]]',
                   'float':'[float(value[0]),*value[1:]]',
                   'out of range':'[value[0]+p,*value[1:]]'}
        for function,checkpoint in (('add_shares','add-shares'),
                                    ('add_constant','add-constant'),
                                    ('mul_constant','mul-constant')):
            for name,expression in mutations.items():
                with self.subTest(function=function,variant=name):
                    source=reference()+f'''
import json,os,sys
original={function}
def {function}(*args):
    value=list(original(*args))
    p=args[-1]
    response={expression}
    call_id=sys._getframe(1).f_locals['call']['callId']
    os.write(1,(json.dumps({{'callId':call_id,'value':response}})+'\\n').encode())
    return tuple(value)
'''
                    expected=name=='correct'
                    self.assertEqual(server.evaluate(checkpoint,source),expected)
                    self.assertEqual(server.evaluate('transfer',source),expected)
                    self.assertEqual(_WORKBENCH.run_public_tests({'linear.py':source})['passed'],expected)

    def test_predictable_reply_is_ignored_independently_of_value_correctness(self):
        for printed_correct in (True,False):
            # A correct fixed-ID frame cannot replace an incorrect actual response;
            # an incorrect fixed-ID frame cannot invalidate a correct actual response.
            source=reference()+f'''
import json
reply_number=0
def add_shares(a,b,p):
    global reply_number
    reply_number+=1
    value=[(x+y)%p for x,y in zip(a,b)]
    wrong=[(value[0]+1)%p,*value[1:]]
    print(json.dumps({{'callId':reply_number,'value':value if {printed_correct} else wrong}}),flush=True)
    return wrong if {printed_correct} else tuple(value)
'''
            self.assertEqual(server.evaluate('add-shares',source),not printed_correct)
            self.assertEqual(_WORKBENCH.run_public_tests({'linear.py':source})['passed'],not printed_correct)

    def test_call_identifiers_are_fresh_and_absent_during_initialization(self):
        source='''import sys
initial_had_id='callId' in sys._getframe(1).f_locals['initial']
def probe():return [initial_had_id,sys._getframe(1).f_locals['call']['callId']]
'''
        with LearnerSession({'linear.py':source}) as learner:
            values=[learner.call('linear','probe',[]) for _ in range(3)]
        self.assertTrue(all(not row[0] for row in values))
        self.assertEqual(len({row[1] for row in values}),3)
        for row in values:self.assertRegex(row[1],r'^[0-9a-f]{32}$')

    def test_in_place_constant_addition_is_a_valid_result(self):
        source=reference()+'''\ndef add_constant(shares,c,p):
    shares[0]=(shares[0]+c)%p
    return shares
'''
        self.assertTrue(server.evaluate('add-constant',source))
        self.assertTrue(server.evaluate('transfer',source))
        self.assertTrue(_WORKBENCH.run_public_tests({'linear.py':source})['passed'])

    def test_persistent_ipc_is_denied_and_leaves_no_objects(self):
        paths=[Path('/proc/sysvipc')/name for name in ('shm','msg','sem')]
        before=[path.read_text() for path in paths]
        source='''import ctypes
def probe():
    libc=ctypes.CDLL(None,use_errno=True)
    calls=[('shmget',(0,4096,0o1600)),('shmat',(-1,None,0)),
           ('shmctl',(-1,0,None)),('msgget',(0,0o1600)),('msgctl',(-1,0,None)),
           ('semget',(0,1,0o1600)),('semctl',(-1,0,0)),('semop',(-1,None,0))]
    results=[]
    for name,args in calls:
        ctypes.set_errno(0)
        result=getattr(libc,name)(*args)
        results.append([result,ctypes.get_errno()])
    return results
'''
        for _ in range(16):
            with LearnerSession({'linear.py':source}) as learner:
                self.assertEqual(learner.call('linear','probe',[]),[[-1,1]]*8)
        self.assertEqual([path.read_text() for path in paths],before)

    def test_public_small_constant_example_catches_every_party_addition(self):
        source=reference()+'\ndef add_constant(shares,c,p):return [(s+c)%p for s in shares]\n'
        with LearnerSession({'linear.py':source}) as learner:
            passed,output=run_cases(learner.module(),public_payload('example'),'small_example')
        self.assertFalse(passed)
        self.assertIn('total after adding 2 must have remainder 6',output)

    def test_private_files_parent_environment_network_and_exec_are_denied(self):
        source='''import ctypes,os,sys

def probe(pids):
    libc=ctypes.CDLL(None,use_errno=True)
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',
           '/problem/tests/hidden/check_linear.py']+['/proc/'+p+'/environ' for p in pids]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0:readable=True;os.close(fd)
    try:os.execv('/bin/true',['/bin/true']);executed=True
    except OSError:executed=False
    return dict(seed='FLAG_SEED' in os.environ,readable=readable,network=libc.socket(2,1,0)>=0,
                executed=executed,checker=any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules))
'''
        pids=[p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        with LearnerSession({'linear.py':source}) as learner:
            self.assertEqual(learner.call('linear','probe',[pids]),dict(seed=False,readable=False,network=False,executed=False,checker=False))

    def test_parent_signal_and_limit_changes_denied_and_fds_closed(self):
        source='''import ctypes,os

def probe(fd):
    libc=ctypes.CDLL(None,use_errno=True)
    class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    try:os.fstat(fd);inherited=True
    except OSError:inherited=False
    return [libc.kill(os.getppid(),0)==-1,libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1,inherited]
'''
        with open('/dev/null') as handle:
            os.set_inheritable(handle.fileno(),True)
            with LearnerSession({'linear.py':source}) as learner:
                self.assertEqual(learner.call('linear','probe',[handle.fileno()]),[True,True,False])

    def test_partial_output_timeout_and_descendant_cleanup(self):
        source='''import os

def probe():
    pid=os.fork()
    if pid==0:
        while True:pass
    return pid

def hang():
    os.write(1,b'{"callId":')
    while True:pass
'''
        start=time.monotonic()
        with LearnerSession({'linear.py':source},timeout=.3) as learner:
            pid=learner.call('linear','probe',[])
            with self.assertRaises(LearnerError):learner.call('linear','hang',[])
        self.assertLess(time.monotonic()-start,3)
        for _ in range(100):
            if not Path(f'/proc/{pid}').exists():break
            time.sleep(.01)
        else:self.fail('forked child was not reaped; a zombie is not success')

    def test_repeated_forks_leave_no_zombies(self):
        source=reference()+'\nimport os\nfor _ in range(4):\n    if os.fork()==0:os._exit(0)\n'
        # Wait for all extra processes, not just zombies: a dying live child can
        # become a zombie between two snapshots. No extra PID means it was reaped.
        baseline={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        for attempt in range(64):
            self.assertTrue(server.evaluate('add-shares',source),attempt)
            for _ in range(200):
                extra={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}-baseline
                if not extra:break
                time.sleep(.01)
            self.assertEqual(extra,set(),f'unreaped processes after submission {attempt+1}')
            self.assertEqual(zombies(),[],f'submission {attempt+1}')

    def test_public_diagnostics_are_source_locations_only_private_is_generic(self):
        for source,line,kind in (('def bad(:\n',1,'SyntaxError'),
                                 ('# line one\nimport missing_learner_module\n',2,'ModuleNotFoundError'),
                                 ('# line one\nraise ValueError("private-path\\nBAD_TEXT")\n',2,'ValueError')):
            result=_WORKBENCH.run_public_tests({'linear.py':source})
            self.assertEqual(result,{'passed':False,'output':f'linear.py:{line}: {kind}'})
            correct,message=server.evaluate_with_message('add-shares',source)
            self.assertFalse(correct)
            self.assertNotIn(kind,message)
            self.assertNotIn('BAD_TEXT',message)

    def test_deep_startup_json_is_not_a_verdict_and_worker_is_removed(self):
        source='print("["*2000+"0"+"]"*2000,flush=True)\nwhile True:pass\n'
        learner=LearnerSession({'linear.py':source},timeout=.2)
        with self.assertRaises(LearnerError):
            with learner:pass
        self.assertIsNotNone(learner.process.returncode)
        self.assertFalse(Path(f'/proc/{learner.process.pid}').exists())

    def test_untrusted_diagnostic_shapes_are_rejected(self):
        learner=LearnerSession({'linear.py':reference()})
        for value in ({'file':[],'line':1,'type':'Error'},
                      {'file':'/hidden/secret.py','line':1,'type':'Error'},
                      {'file':'linear.py','line':True,'type':'Error'},
                      {'file':'linear.py','line':1,'type':'Error\nPASS'},
                      {'file':'linear.py','line':100000,'type':'Error'}):
            self.assertEqual(learner._initialization_diagnostic(value),'')

    def test_hidden_input_prints_and_exceptions_never_reach_feedback(self):
        source='''def add_shares(a,b,p):
    print('HIDDEN_INPUT:'+str(a),flush=True)
    raise ValueError('HIDDEN_INPUT:'+str(a))
'''
        correct,message=server.evaluate_with_message('add-shares',source)
        self.assertFalse(correct)
        self.assertNotIn('HIDDEN_INPUT',message)

    def test_manual_seal_and_negative_manual_classification(self):
        answer={name:OPERATION_ROUNDS[name] for name in operations(server.SEED)}
        prepared=_WORKBENCH.prepare_submissions({'linear.py':reference()},{'no-communication':json.dumps(answer)})
        sealed=prepared['submissions']['no-communication']
        self.assertTrue(sealed.startswith('tcw1.'))
        self.assertTrue(server.evaluate('no-communication',server._unwrap_submission('no-communication',sealed)))
        self.assertIsNone(server._unwrap_submission('no-communication',answer))
        for name in answer:
            if answer[name]>0:
                wrong=dict(answer);wrong[name]=-1
                self.assertFalse(server.evaluate('no-communication',wrong))
                break


if __name__=='__main__':unittest.main()
