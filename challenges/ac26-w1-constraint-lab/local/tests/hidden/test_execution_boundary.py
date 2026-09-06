"""Actual Linux worker/graded-value boundary; all seeds here are synthetic test inputs."""
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
from verifier import server


def reference_sources():
    return {name:(ROOT/'reference'/name).read_text() for name in server.SUBMITTED_FILES}


def field_source(body):
    return {'field.py': 'import os,sys,ctypes\nclass Field:\n    def __init__(self,p):self.modulus=p\n'+body,
            'circuit.py': '# unused', 'gadgets.py': '# unused'}


@unittest.skipUnless(sys.platform == 'linux', 'requires deployed Linux seccomp')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_reference_code_still_passes_all_phases_on_multiple_runs(self):
        for seed in ('boundary-one','boundary-two'):
            with self.subTest(seed=seed), patch.object(server,'SEED',seed):
                for checkpoint in server.CODE_CHECKPOINTS:
                    correct,message=server.evaluate(checkpoint,reference_sources())
                    self.assertTrue(correct,(checkpoint,message))

    def test_stdout_cannot_forge_any_of_the_four_grades(self):
        for source in (
            'import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
            'import os\nprint(\'{"callId": 1, "value": 0}\',flush=True)\nos._exit(0)',
            'from tests.hidden import check_circuit\ncheck_circuit.run=lambda *args:[]',
        ):
            for checkpoint in server.CODE_CHECKPOINTS:
                files=reference_sources();files['field.py']=source
                with self.subTest(checkpoint=checkpoint,source=source):
                    self.assertFalse(server.evaluate(checkpoint,files)[0])

    def test_private_files_proc_environments_network_and_exec_are_denied(self):
        source=field_source('''    def normalize(self,pids):
        libc=ctypes.CDLL(None,use_errno=True)
        paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',
               '/problem/tests/hidden/check_circuit.py']+['/proc/'+p+'/environ' for p in pids]
        readable=False
        for path in paths:
            fd=libc.open(path.encode(),0)
            if fd>=0: readable=True;os.close(fd)
        network=libc.socket(2,1,0)>=0
        try:
            os.execv('/bin/true',['/bin/true'])
            executed=True
        except OSError: executed=False
        return {'seed':'FLAG_SEED' in os.environ,'readable':readable,'network':network,'exec':executed,
                'checker_loaded':any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)}
''')
        pids=[p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        with LearnerSession(source) as learner:
            value=learner.call('field','normalize',[pids],97)
        self.assertEqual(value,dict(seed=False,readable=False,network=False,exec=False,checker_loaded=False))

    def test_same_uid_supervisor_signal_and_limit_changes_are_denied(self):
        source=field_source('''    def normalize(self,_):
        libc=ctypes.CDLL(None,use_errno=True)
        class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
        limit=Limit(0,0)
        return [libc.kill(os.getppid(),0)==-1,
                libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1]
''')
        with LearnerSession(source) as learner:
            self.assertEqual(learner.call('field','normalize',[0],97),[True,True])

    def test_partial_output_and_blocked_input_respect_one_deadline(self):
        sources=field_source('''    def normalize(self,_):
        os.write(1,b'{"callId":')
        while True: pass
''')
        start=time.monotonic()
        with LearnerSession(sources,timeout=.2) as learner:
            with self.assertRaises(LearnerError):
                learner.call('field','normalize',[0],97)
        self.assertLess(time.monotonic()-start,3)
        sources=field_source('''    def normalize(self,_):
        return 0
''')
        # A worker that has stopped reading must not pin the parent while it writes.
        with LearnerSession(sources,timeout=.2) as learner:
            os.kill(learner.process.pid,19)  # SIGSTOP, trusted test parent only
            start=time.monotonic()
            with self.assertRaises(LearnerError):
                learner.call('field','normalize',['x'*200000],97)
            self.assertLess(time.monotonic()-start,3)

    def test_completion_removes_forked_children(self):
        sources=field_source('''    def normalize(self,_):
        pid=os.fork()
        if pid==0:
            while True: pass
        return pid
''')
        with LearnerSession(sources) as learner:
            pid=learner.call('field','normalize',[0],97)
        for _ in range(50):
            status=Path(f'/proc/{pid}/stat')
            if not status.exists() or status.read_text().split()[2]=='Z':break
            time.sleep(.02)
        else:self.fail('forked learner still running after completion')

    def test_outer_grade_timeout_removes_nested_worker_group(self):
        # This synthetic trusted-runner stub reproduces a hung nested worker without
        # printing private values. The normal runner shares this process group.
        script='''import os,time
pid=os.fork()
if pid==0:
    while True:time.sleep(1)
open({workspace!r}+"/child", "w").write(str(pid))
while True:time.sleep(1)
'''
        # Capture the child PID through the temporary directory creator while keeping
        # the production launcher and its timeout/finally path intact.
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            class Context:
                def __enter__(self):return directory
                def __exit__(self,*args):return False
            with patch.object(server.tempfile,'TemporaryDirectory',return_value=Context()), patch.object(server,'RUN_TIMEOUT_SECONDS',.2):
                self.assertIsNone(server._run_submission_script(reference_sources(),script,'synthetic'))
            pid=int((Path(directory)/'child').read_text())
            for _ in range(50):
                status=Path(f'/proc/{pid}/stat')
                if not status.exists() or status.read_text().split()[2]=='Z':break
                time.sleep(.02)
            else:self.fail('nested child survived outer grader timeout')

    def test_hidden_input_prints_never_reach_grading_feedback(self):
        files=reference_sources()
        files['gadgets.py']='''def membership_constraints(signal,allowed):
    print('UNSEEN_ALLOWED:'+str(allowed),flush=True)
    raise ValueError('UNSEEN_ALLOWED:'+str(allowed))
'''
        correct,message=server.evaluate('membership',files)
        self.assertFalse(correct)
        self.assertNotIn('UNSEEN_ALLOWED',message)

    def test_gadgets_cannot_trust_a_fake_evaluator(self):
        files=reference_sources()
        files['circuit.py']='def evaluate(*args):return 0\ndef trace(*args):return []\ndef first_broken(*args):return None'
        files['gadgets.py']='def boolean_constraint(signal):return {"id":"x","kind":"magic","signal":signal}'
        correct,message=server.evaluate('boolean',files)
        self.assertFalse(correct)
        self.assertIn('five documented kinds',message)


class ManualAnswerContract(unittest.TestCase):
    def test_first_broken_rejects_wrong_shape_boolean_and_fraction(self):
        for answer in ({'constraintId':'c3','residual':True},{'constraintId':'c3','residual':80.5},
                       {'id':'c3','residual':80},{'constraintId':'c3','residual':80,'extra':1}):
            self.assertFalse(server._check_first_broken(answer))


if __name__=='__main__':unittest.main()
