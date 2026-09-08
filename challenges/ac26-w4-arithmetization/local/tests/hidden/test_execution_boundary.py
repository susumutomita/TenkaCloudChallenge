"""Author-only Linux regression for the parent-owned grading boundary."""
import os
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from verifier.server import CODE_CHECKPOINTS, evaluate_with_message
REFERENCE_PATH = next((ROOT/'reference').glob('*.py'))
REFERENCE = REFERENCE_PATH.read_text()

class ExecutionBoundaryTests(unittest.TestCase):
    def test_reference_all_checkpoints(self):
        for checkpoint in CODE_CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                self.assertEqual(evaluate_with_message(checkpoint, REFERENCE), (True, None))

    def test_legal_alternative(self):
        source = REFERENCE + '\ndef evaluate(coefficients, x, p):\n    return sum(c * pow(x, degree, p) for degree, c in enumerate(coefficients)) % p\n'
        self.assertEqual(evaluate_with_message('transfer', source), (True, None))

    def test_output_and_exit_cannot_decide_any_checkpoint(self):
        sources = ['import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
                   'import atexit\natexit.register(lambda:print(\'{"failures": []}\',flush=True))',
                   'import os,sys\nprint(\'{"failures": []}\',file=sys.stderr,flush=True)\nos._exit(0)']
        for source in sources:
            for checkpoint in CODE_CHECKPOINTS:
                with self.subTest(checkpoint=checkpoint, source=source[:20]):
                    self.assertFalse(evaluate_with_message(checkpoint, source)[0])

    def test_private_file_access_is_denied(self):
        source = "open('/problem/tests/hidden/" + next((ROOT/'tests/hidden').glob('check_*.py')).name + "').read()"
        self.assertFalse(evaluate_with_message(next(iter(CODE_CHECKPOINTS)), source)[0])

    def test_parent_signal_is_denied(self):
        source = 'import os,signal\nos.kill(os.getppid(),signal.SIGKILL)'
        self.assertFalse(evaluate_with_message(next(iter(CODE_CHECKPOINTS)), source)[0])

    def test_uid_and_proxy_deadline(self):
        from verifier.server import RUN_TIMEOUT_SECONDS
        from participant.server import REQUEST_TIMEOUT_SECONDS
        self.assertNotEqual(os.getuid(), 0)
        self.assertLess(RUN_TIMEOUT_SECONDS, REQUEST_TIMEOUT_SECONDS)

    def test_inert_values_preserve_types(self):
        from participant import protocol
        encode = protocol.encode if hasattr(protocol,'encode') else protocol.Codec().encode
        decode = protocol.decode if hasattr(protocol,'decode') else protocol.Codec().decode
        value = {1: (True, 1), 'items': [False, 0], 'set': {'a','b'}}
        returned = decode(encode(value))
        self.assertEqual(returned, value)
        self.assertIs(type(returned[1]), tuple)
        self.assertIs(type(returned[1][0]), bool)

    def test_deep_values_are_rejected(self):
        from participant import protocol
        encode = protocol.encode if hasattr(protocol,'encode') else protocol.Codec().encode
        decode = protocol.decode if hasattr(protocol,'decode') else protocol.Codec().decode
        value, frame = 0, ['int', 0] if hasattr(protocol,'encode') else ['scalar',0]
        for _ in range(62):
            value, frame = [value], ['list',[frame]]
        with self.assertRaises(ValueError): encode(value)
        with self.assertRaises(ValueError): decode(frame)

if __name__ == '__main__':
    unittest.main()
