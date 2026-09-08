"""Linux integration tests for the trusted parent and inert function-value boundary."""
from pathlib import Path
import os
import sys
import unittest
from participant.execution import LearnerSession, LearnerError
from participant.protocol import decode, encode
from verifier.server import CHECKPOINTS, evaluate_with_message

ROOT = Path(__file__).resolve().parents[2]
MODULE = 'rgsw'
REFERENCE = (ROOT / 'reference' / (MODULE + '.py')).read_text()

@unittest.skipUnless(sys.platform == 'linux', 'requires the deployed Linux isolation')
class BoundaryTests(unittest.TestCase):
    def test_reference_all_checkpoints(self):
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                self.assertEqual(evaluate_with_message(checkpoint, REFERENCE), (True, None))

    def test_missing_functions_early_exit_and_diagnostic_output_fail_closed(self):
        cases = ('print("diagnostic only")', 'raise SystemExit(0)',
                 'import sys\nprint("diagnostic only", file=sys.stderr)\nraise SystemExit(0)',
                 'import atexit\natexit.register(lambda: print("diagnostic only"))')
        for source in cases:
            for checkpoint in CHECKPOINTS:
                with self.subTest(checkpoint=checkpoint, source=source):
                    correct, message = evaluate_with_message(checkpoint, source)
                    self.assertFalse(correct)
                    self.assertNotIn('diagnostic only', message or '')

    def test_typed_value_channel_preserves_legal_alternatives(self):
        source = 'def echo(value): return value\ndef refuse(): raise CustomError()\nclass CustomError(ValueError): pass'
        with LearnerSession({MODULE+'.py': source}) as session:
            value = {0: (True, 1, None), 'list': [False, 0]}
            returned = session.call(MODULE, 'echo', (value,))
            self.assertEqual(returned, value)
            self.assertIs(type(returned[0]), tuple)
            self.assertIs(type(returned[0][0]), bool)
            self.assertIs(type(returned['list']), list)
            with self.assertRaises(ValueError):
                session.call(MODULE, 'refuse', ())

    def test_parent_deadline_and_bad_values_fail_closed(self):
        with self.assertRaises(LearnerError):
            with LearnerSession({MODULE+'.py': 'while True: pass'}, timeout=0.2):
                pass
        with LearnerSession({MODULE+'.py': 'def bad(): return object()'}) as session:
            with self.assertRaises(LearnerError):
                session.call(MODULE, 'bad', ())

    def test_hidden_files_and_parent_process_are_outside_worker_authority(self):
        source = """
from pathlib import Path
import os
def probe(path):
    try:
        Path(path).read_text()
    except PermissionError:
        return True
    return False
def signal_probe():
    try:
        os.kill(os.getppid(), 0)
    except PermissionError:
        return True
    return False
"""
        with LearnerSession({MODULE+'.py': source}) as session:
            for path in ('/problem/tests/hidden/check_'+MODULE+'.py', '/proc/self/environ'):
                self.assertIs(session.call(MODULE, 'probe', (path,)), True)
            self.assertIs(session.call(MODULE, 'signal_probe', ()), True)

    def test_author_image_is_nonroot(self):
        self.assertNotEqual(os.geteuid(), 0)

class ValueCodecTests(unittest.TestCase):
    def test_inert_values_and_strict_types(self):
        value = {0: (True, 1, None), 'list': [False, 0]}
        self.assertEqual(decode(encode(value)), value)
        for value in (['bool', 1], ['int', True], ['tuple', {}], ['object', {}]):
            with self.assertRaises((ValueError, TypeError)):
                decode(value)

if __name__ == '__main__':
    unittest.main()
