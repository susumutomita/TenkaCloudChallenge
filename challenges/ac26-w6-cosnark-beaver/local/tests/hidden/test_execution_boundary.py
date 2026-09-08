"""Author-only checks for the real Linux parent/worker grading boundary."""
from pathlib import Path
import sys
import os
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from verifier.server import CHECKPOINTS, evaluate_with_message

REFERENCE = (ROOT/'reference/prover.py').read_text()


class ExecutionBoundaryTests(unittest.TestCase):
    def test_reference_all_checkpoints(self):
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                self.assertEqual(evaluate_with_message(checkpoint, REFERENCE), (True, None))

    def test_stdout_or_exit_cannot_supply_a_verdict(self):
        submissions = [
            'import os\nprint(\'{"failures": []}\', flush=True)\nos._exit(0)',
            'import atexit\natexit.register(lambda:print(\'{"failures": []}\',flush=True))',
            'import sys,os\nprint(\'{"failures": []}\',file=sys.stderr,flush=True)\nos._exit(0)',
        ]
        for source in submissions:
            for checkpoint in CHECKPOINTS:
                with self.subTest(checkpoint=checkpoint, source=source[:15]):
                    self.assertFalse(evaluate_with_message(checkpoint, source)[0])

    def test_child_cannot_load_checker_or_private_file(self):
        for source in ['from tests.hidden import check_prover',
                       "open('/problem/tests/hidden/check_prover.py').read()"]:
            self.assertFalse(evaluate_with_message('plan', source)[0])

    def test_child_cannot_signal_parent(self):
        source = 'import os,signal\nos.kill(os.getppid(),signal.SIGKILL)'
        self.assertFalse(evaluate_with_message('plan', source)[0])

    def test_local_alternative_cancellation(self):
        source = REFERENCE[:REFERENCE.index('def mask_cancellation_witness')] + '''def mask_cancellation_witness(runtime, halves, triple):
    out=[]
    for i in range(runtime.setting['parties']):
        with runtime.party_scope(i):
            zero=runtime.mul_public(triple.x[i],0)
            out.append(runtime.add_public(runtime.add(halves['A'][i],zero),0))
    return tuple(out)
'''
        self.assertEqual(evaluate_with_message('transfer', source), (True, None))

    def test_direct_read_is_observed_outside_worker(self):
        source = REFERENCE.replace('    out = []\n    for i in range(runtime.setting["parties"]):',
            '    with runtime.party_scope(0):\n        runtime.value_of(halves["A"][0])\n    out = []\n    for i in range(runtime.setting["parties"]):')
        self.assertNotEqual(source, REFERENCE)
        verdict = evaluate_with_message('transfer', source)
        self.assertFalse(verdict[0])
        self.assertIn('read values directly', verdict[1])

    def test_past_reconstruction_capability_cannot_read_current_shares(self):
        source = REFERENCE + """
_saved_runtime = None
_original_audit = privacy_audit
_original_cancellation = mask_cancellation_witness
def privacy_audit(runtime, relation, halves, triple):
    global _saved_runtime
    if hasattr(runtime, 'reconstruct'):
        _saved_runtime = runtime
    return _original_audit(runtime, relation, halves, triple)
def mask_cancellation_witness(runtime, halves, triple):
    recovered = _saved_runtime.reconstruct(halves['A'])
    return _original_cancellation(runtime, halves, triple)
"""
        self.assertFalse(evaluate_with_message('transfer', source)[0])

    def test_nonroot_and_proxy_time_budget(self):
        from verifier.server import RUN_TIMEOUT_SECONDS
        from participant.server import REQUEST_TIMEOUT_SECONDS
        self.assertNotEqual(os.getuid(), 0)
        self.assertLess(RUN_TIMEOUT_SECONDS, REQUEST_TIMEOUT_SECONDS)

    def test_codec_rejects_excessive_nesting(self):
        from participant.protocol import Codec
        frame = ['scalar', 0]
        value = 0
        for _ in range(62):
            frame = ['list', [frame]]
            value = [value]
        with self.assertRaises(ValueError):
            Codec().decode(frame)
        with self.assertRaises(ValueError):
            Codec().encode(value)

    def test_unknown_object_handle_is_rejected(self):
        from participant.protocol import Codec
        with self.assertRaises(ValueError):
            Codec(parent=True).decode(['ref','unissued'])

    def test_protocol_preserves_types_without_value_access(self):
        from participant.protocol import Codec
        parent, child = Codec(parent=True), Codec()
        value = {'tuple': (True, 1), 'list': [False, 0], 'set': {'a','b'}}
        decoded = parent.decode(child.encode(child.decode(parent.encode(value))))
        self.assertEqual(decoded, value)
        self.assertIs(type(decoded['tuple']), tuple)
        self.assertIs(type(decoded['tuple'][0]), bool)
        from participant.mpc import Share
        share = Share(0,'F7','s',5)
        proxy = child.decode(parent.encode(share))
        with self.assertRaises(AttributeError):
            _ = proxy._value
        self.assertIs(parent.decode(child.encode(proxy)), share)


if __name__ == '__main__':
    unittest.main()
