"""Author-only grading boundary tests; cryptographic logic has its own mutation suite."""
from pathlib import Path
import sys
import os
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from verifier import server

ROOT = Path(__file__).resolve().parents[2]


def reference():
    return (ROOT / 'reference/guest.py').read_text()


@unittest.skipUnless(sys.platform == 'linux', 'deployed execution requires Linux seccomp')
class ExecutionBoundary(unittest.TestCase):
    def test_deployed_limits_have_nonroot_and_proxy_headroom(self):
        from participant.server import REQUEST_TIMEOUT_SECONDS
        self.assertNotEqual(os.getuid(), 0)
        self.assertLess(server.RUN_TIMEOUT_SECONDS, REQUEST_TIMEOUT_SECONDS)

    def test_reference_is_accepted_at_all_checkpoints(self):
        for checkpoint in server.CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                self.assertEqual(server.evaluate_with_message(checkpoint, reference()), (True, None))

    def test_accepted_sequence_alternative_stays_accepted(self):
        source = reference().replace('"wrapped": tuple(sorted(set(wrapped))),',
                                     '"wrapped": sorted(set(wrapped)),')
        self.assertNotEqual(source, reference())
        self.assertTrue(server.evaluate('transfer', source))

    def test_value_error_subclass_is_a_valid_refusal(self):
        source = reference().replace('from __future__ import annotations',
                                     'from __future__ import annotations\nclass InputError(ValueError): pass')
        source = source.replace('raise ValueError(', 'raise InputError(')
        self.assertTrue(server.evaluate('transfer', source))

    def test_stdout_cannot_claim_a_verdict(self):
        sources = (
            'import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
            'import os\nos._exit(0)',
            'import atexit,json\natexit.register(lambda:print(json.dumps({"failures":[]})))',
            'import os\nprint(\'{"ready":true}\',flush=True)\n'
            'print(\'{"callId":"00000000000000000000000000000000","value":["scalar",true]}\',flush=True)\nos._exit(0)',
        )
        for source in sources:
            for checkpoint in server.CHECKPOINTS:
                with self.subTest(source=source, checkpoint=checkpoint):
                    self.assertFalse(server.evaluate(checkpoint, source))

    def test_function_exit_is_not_a_success(self):
        source = reference() + '\nimport os\ndef encode_statement(statement):\n print(\'{"failures":[]}\',flush=True)\n os._exit(0)\n'
        self.assertFalse(server.evaluate('encoding', source))

    def test_parent_owns_input_observations(self):
        source = reference() + '''
def guest_input(env, statement, witness):
    env._writes = 1
    env._public = statement
    env._private = witness
'''
        self.assertFalse(server.evaluate('ingestion', source))

    def test_hidden_checker_is_not_importable_after_initialization(self):
        source = reference() + '''
def encode_statement(statement):
    from tests.hidden.check_guest import _encode
    return _encode(statement)
'''
        self.assertFalse(server.evaluate('encoding', source))

    def test_worker_cannot_mutate_parent_vocabulary(self):
        source = reference().replace('from __future__ import annotations',
                                     'from __future__ import annotations\nimport participant.lab as lab\nlab.STATEMENT_FIELDS=()')
        self.assertFalse(server.evaluate('encoding', source))

    def test_timeout_and_failed_worker_do_not_break_next_submission(self):
        old = server.RUN_TIMEOUT_SECONDS
        try:
            server.RUN_TIMEOUT_SECONDS = 0.15
            self.assertFalse(server.evaluate('encoding', 'while True: pass'))
        finally:
            server.RUN_TIMEOUT_SECONDS = old
        self.assertTrue(server.evaluate('encoding', reference()))

    def test_failure_messages_remain_bounded(self):
        correct, message = server.evaluate_with_message('encoding', 'def encode_statement(statement): return b""')
        self.assertIs(correct, False)
        self.assertIsInstance(message, str)
        self.assertLessEqual(len(message), 1900)


class ValueProtocol(unittest.TestCase):
    def test_typed_values_and_nesting_limit(self):
        from participant.protocol import encode, decode
        value = {'data': bytearray(b'abc'), 'tuple': (True, 1), 'list': [False, 0]}
        restored = decode(encode(value))
        self.assertEqual(restored, value)
        self.assertIs(type(restored['data']), bytearray)
        self.assertIs(type(restored['tuple']), tuple)
        self.assertIs(type(restored['tuple'][0]), bool)
        nested = ['scalar', 0]
        for _ in range(62):
            nested = ['list', [nested]]
        with self.assertRaises(ValueError):
            decode(nested)


if __name__ == '__main__':
    unittest.main()
