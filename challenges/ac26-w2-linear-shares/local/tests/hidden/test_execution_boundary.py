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
