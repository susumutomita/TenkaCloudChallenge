"""Local, synthetic checks for the isolated worker and authoritative parent verdict."""
import json
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fixtures.generate import params
from participant import execution
from participant.isolation import protect_supervisor
from verifier import server

REFERENCE = (ROOT / 'reference/policy.py').read_text()


class DiagnosisValues(unittest.TestCase):
    def test_only_canonical_integer_changes_are_a_diagnosis(self):
        for seed in ('diagnosis-a', 'diagnosis-b', 'diagnosis-c', 'diagnosis-d'):
            with patch.object(server, 'SEED', seed):
                answer = server._expected_root_cause(seed)
                self.assertTrue(server._check_root_cause(answer))
                for value in (True, False, 0.5, None, [], {}, '0', -1, params(seed)['p']):
                    bad = json.loads(json.dumps(answer))
                    bad['manipulatedSignals'][0]['after'] = value
                    self.assertFalse(server._check_root_cause(bad), type(value).__name__)
                if answer['missingConstraintId'] == 'c-iszero-a':
                    change = answer['manipulatedSignals'][0]
                    change['after'] = (change['before'] + 1) % params(seed)['p']
                    self.assertTrue(server._check_root_cause(answer))


@unittest.skipUnless(sys.platform == 'linux', 'deployed worker uses Linux process isolation')
class WorkerBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_real_source_passes_all_five_code_checkpoints(self):
        for seed in ('local-one', 'local-two'):
            with patch.object(server, 'SEED', seed):
                for checkpoint in server.CODE_CHECKPOINTS:
                    self.assertTrue(server.evaluate(checkpoint, REFERENCE)[0], checkpoint)

    def test_stdout_and_zero_exit_cannot_declare_a_verdict(self):
        for source in ('import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
                       'import os\nprint(\'{"values": [{"returned": []}]}\',flush=True)\nos._exit(0)',
                       'from tests.hidden import check_policy\ncheck_policy.run=lambda *args:[]',
                       'import sys\nsys.modules["tests.hidden.check_policy"].run=lambda *args:[]'):
            for checkpoint in server.CODE_CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint, source)[0], checkpoint)

    def test_checkpoint_independence_survives_unrelated_function_errors(self):
        source = REFERENCE + '\ndef audit(circuit): raise NotImplementedError()\ndef repair(circuit): raise NotImplementedError()\n'
        self.assertTrue(server.evaluate('build', source)[0])
        self.assertTrue(server.evaluate('exploit', REFERENCE + '\ndef repair(circuit): raise NotImplementedError()\n')[0])
        self.assertFalse(server.evaluate('audit', source)[0])

    def test_unused_looping_function_does_not_block_an_independent_checkpoint(self):
        source = REFERENCE + '\ndef repair(circuit):\n    while True: pass\n'
        with patch.object(execution, 'RUN_TIMEOUT_SECONDS', .5):
            self.assertTrue(server.evaluate('build', source)[0])
            self.assertTrue(server.evaluate('audit', source)[0])
            self.assertTrue(server.evaluate('exploit', source)[0])
            self.assertFalse(server.evaluate('repair', source)[0])
            source = REFERENCE + '\ndef forge_witness(circuit, params):\n    while True: pass\n'
            self.assertTrue(server.evaluate('repair', source)[0])
            self.assertFalse(server.evaluate('mutation-transfer', source)[0])

    def test_supplied_evaluator_import_is_available_to_real_worker(self):
        source = '''from participant.evaluator import residual, satisfies

def intended_circuit():
    c={'kind':'iszero_a','value':'x','inv':'r','out':'z'}
    w={'x':3,'r':5,'z':0}
    return [residual(c,w,7), satisfies([c],w,7)]
'''
        result = execution.run_functions({'policy.py': source}, [{'function':'intended_circuit','args':[]}])
        self.assertEqual(result['values'], [{'returned':[0, True]}])

    def test_unseen_inputs_and_exceptions_are_not_feedback(self):
        source = REFERENCE + '''
def forge_witness(circuit, params):
    print('UNSEEN:'+str(params),flush=True)
    raise ValueError('UNSEEN:'+str(params))
'''
        result = server.evaluate('exploit', source)
        self.assertFalse(result[0])
        self.assertNotIn('UNSEEN:', result[1])
        self.assertNotIn('revoked', result[1])

    def test_false_helper_must_preserve_the_fixed_inputs(self):
        source = REFERENCE + '''
def forge_witness(circuit, params):
    return {'revoked':0,'inv':0,'ok':0,'issuer_ok':1,'granted':0}
'''
        self.assertFalse(server.evaluate('exploit', source)[0])

    def test_private_files_and_network_are_denied_before_source_runs(self):
        source = '''import os, sys, ctypes
libc=ctypes.CDLL(None,use_errno=True)
def intended_circuit():
    allowed=[]
    for p in ['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py','/problem/tests/hidden/check_policy.py']:
        fd=libc.open(p.encode(),0)
        allowed.append(fd>=0)
        if fd>=0: os.close(fd)
    fd=libc.socket(2,1,0)
    allowed.append(fd>=0)
    if fd>=0: os.close(fd)
    return allowed+['FLAG_SEED' in os.environ, any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)]
'''
        result = execution.run_functions({'policy.py': source}, [{'function':'intended_circuit','args':[]}])
        self.assertEqual(result['values'], [{'returned':[False]*7}])

    def test_timeout_is_bounded(self):
        with patch.object(execution, 'RUN_TIMEOUT_SECONDS', .2):
            self.assertIsNone(execution.run_functions({'policy.py':'while True: pass'}, []))

    def test_same_uid_learner_cannot_signal_or_modify_supervisor(self):
        source = '''import os,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def intended_circuit():
    pid=os.getppid()
    signal_denied=libc.kill(pid,0)==-1
    class Limit(ctypes.Structure): _fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    limit_denied=libc.prlimit64(pid,1,ctypes.byref(limit),None)==-1
    return [signal_denied,limit_denied]
'''
        result = execution.run_functions({'policy.py':source}, [{'function':'intended_circuit','args':[]}])
        self.assertEqual(result['values'], [{'returned':[True, True]}])

    def test_success_cleans_forked_children(self):
        source = '''import os
def intended_circuit():
    pid=os.fork()
    if pid==0:
        while True: pass
    return pid
'''
        result = execution.run_functions({'policy.py':source}, [{'function':'intended_circuit','args':[]}])
        pid = result['values'][0]['returned']
        for _ in range(50):
            status = Path(f'/proc/{pid}/stat')
            if not status.exists() or status.read_text().split()[2] == 'Z':
                break
            time.sleep(.02)
        else:
            self.fail('forked learner remains running after successful response')


if __name__ == '__main__':
    unittest.main()
