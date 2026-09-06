"""Exercise the deployed Linux worker and parent grading boundary, with synthetic runs only."""
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
from fixtures.generate import public_payload
from participant import execution
from participant.isolation import protect_supervisor
from verifier import server

COUNTEREXAMPLES = '''
def inside(s):
    for w in range(s['lo'], s['hi']+1):
        if (s['a']*w+s['b']) % s['p'] == s['c']: return w
    raise ValueError('no valid value')
def incompleteness_witness(s): return inside(s)
def unsoundness_witness(s):
    w=inside(s)
    while w<=s['hi']: w+=s['p']
    return w
def extract_witness(t): return t['opening']['value']
'''


def public_sources(seed):
    public = public_payload(seed)
    matrix = {}
    for name, checks in public['verifiers'].items():
        matrix[name] = {
            'complete': 'range(strict-lo)' not in checks,
            'sound': 'range' in checks or 'range(strict-lo)' in checks,
            'private': name != public['privacyProtocol'],
        }
    return {'classify.py': f'def classify(name): return {matrix!r}[name]\n',
            'counterexamples.py': COUNTEREXAMPLES}


@unittest.skipUnless(sys.platform == 'linux', 'deployed evaluator requires Linux seccomp')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_public_aliases_work_on_unseen_numbers_across_runs(self):
        for seed in ('reader-one', 'reader-two', 'reader-three'):
            with self.subTest(seed=seed), patch.object(server, 'SEED', seed):
                files = public_sources(seed)
                result = server.prepare_submissions(seed, files)
                self.assertTrue(result['ok'])
                for checkpoint, submission in result['submissions'].items():
                    self.assertTrue(server.evaluate(checkpoint, submission)[0], checkpoint)
                # They know only this deployment's names, not the hidden seed's aliases.
                self.assertNotEqual(set(public_payload(seed)['verifiers']),
                                    set(public_payload(seed+':transfer')['verifiers']))

    def test_child_cannot_declare_the_verdict_or_import_the_checker(self):
        for source in (
            'import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
            'from fixtures.generate import TRUTH\ndef classify(p):return TRUTH[p]',
            'import os\nprint(\'{"values": [true,true,true,true,true,true,true,true,true,true,true,true]}\',flush=True)\nos._exit(0)',
            'import sys\nsys.modules["tests.hidden.check_properties"].run=lambda *a:[]',
        ):
            with self.subTest(source=source):
                files = public_sources('boundary-negative')
                files['classify.py'] = source
                self.assertFalse(server._check_transfer(files)[0])

    def test_open_network_exec_and_all_process_environments_are_inaccessible(self):
        source = '''import os,sys,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def classify(_):
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',
           '/problem/tests/hidden/check_properties.py']
    paths += ['/proc/'+p+'/environ' for p in _]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0:
            readable=True
            os.close(fd)
    fd=libc.socket(2,1,0)
    network=fd>=0
    if network: os.close(fd)
    try:
        os.execv('/bin/true',['/bin/true'])
        exec_allowed=True
    except OSError: exec_allowed=False
    return {'seed_present':'FLAG_SEED' in os.environ, 'private_file_readable':readable,
            'network_allowed':network,'exec_allowed':exec_allowed,
            'checker_loaded':any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)}
'''
        result = execution.run_functions({'classify.py': source, 'counterexamples.py': ''},
                                         [{'function': 'classify', 'argument': [p.name for p in Path('/proc').iterdir() if p.name.isdigit()]}])
        self.assertEqual(result['values'], [dict(seed_present=False, private_file_readable=False,
                         network_allowed=False, exec_allowed=False, checker_loaded=False)])

    def test_same_uid_learner_cannot_signal_or_modify_supervisor(self):
        source = '''import os,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def classify(_):
    pid=os.getppid()
    signal_denied=libc.kill(pid,0)==-1
    class Limit(ctypes.Structure): _fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    limit_denied=libc.prlimit64(pid,1,ctypes.byref(limit),None)==-1
    return [signal_denied,limit_denied]
'''
        result = execution.run_functions({'classify.py': source, 'counterexamples.py': ''},
                                         [{'function': 'classify', 'argument': ''}])
        self.assertEqual(result['values'], [[True, True]])

    def test_timeout_and_success_clean_forked_children(self):
        fork = '''import os
def classify(_):
    pid=os.fork()
    if pid==0:
        while True: pass
    return pid
'''
        result = execution.run_functions({'classify.py': fork, 'counterexamples.py': ''},
                                         [{'function': 'classify', 'argument': ''}])
        pid = result['values'][0]
        for _ in range(50):
            status = Path(f'/proc/{pid}/stat')
            if not status.exists() or status.read_text().split()[2] == 'Z':
                break
            time.sleep(.02)
        else:
            self.fail('forked learner remains running after successful response')
        spin = 'while True: pass\n'
        with patch.object(execution, 'RUN_TIMEOUT_SECONDS', .2):
            start = time.monotonic()
            result = execution.run_functions({'classify.py': spin, 'counterexamples.py': ''}, [])
            self.assertIsNone(result)
            self.assertLess(time.monotonic()-start, 3)

    def test_failed_prepare_does_not_echo_unseen_values(self):
        files = public_sources('prepare-private')
        files['counterexamples.py'] = '''
def incompleteness_witness(s):
    print('UNSEEN_INPUT:'+str(s),flush=True)
    raise RuntimeError('UNSEEN_INPUT:'+str(s))
'''
        result = server.prepare_submissions('prepare-private', files)
        self.assertFalse(result['ok'])
        self.assertNotIn('UNSEEN_INPUT', json.dumps(result))

    def test_fixed_displayed_answers_do_not_transfer(self):
        seed='fixed-answer-negative'
        with patch.object(server,'SEED',seed):
            good=public_sources(seed)
            prepared=server.prepare_submissions(seed,good)['submissions']
            files=dict(good)
            files['counterexamples.py']=(
                'def incompleteness_witness(s):return '+prepared['incompleteness']+'\n'
                'def unsoundness_witness(s):return '+prepared['unsoundness']+'\n'
                'def extract_witness(t):return '+prepared['privacy-leak']+'\n')
            self.assertFalse(server._check_transfer(files)[0])


class IntegerContract(unittest.TestCase):
    def test_numeric_answers_reject_boolean_and_fraction(self):
        for value in (True,False,3.5,[],{}):
            self.assertIsNone(server._normalized_int(value))
        self.assertEqual(server._normalized_int(' -3 '), -3)


if __name__ == '__main__':
    unittest.main()
