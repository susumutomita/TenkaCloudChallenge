"""Author regression for copying actual public output into the answer fields.

The reference supplies scratchpad functions for this transport check; this is not
independent participant solving. No reference file is shipped to participants.
"""
import contextlib
import importlib.util
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fixtures.generate import public_payload
from participant import server
from verifier import server as verifier


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def answer_texts(output):
    """Copy only the text after the arrow; do not repair or reserialize it."""
    answers = {}
    for line in output.splitlines():
        name, arrow, value = line.partition(' -> ')
        if arrow and name.strip() in server.CHECKPOINTS:
            answers[name.strip()] = value
    return answers


class PublicOutput(unittest.TestCase):
    def test_real_function_output_can_be_prepared_and_verified_unchanged(self):
        reference = load_module('output_reference', ROOT / 'reference/schnorr_drill.py')
        with patch.dict(sys.modules, {'schnorr_drill': reference}):
            public_test = load_module('output_public_test', ROOT / 'tests/public/test_schnorr_drill.py')
        transfer = reference.transfer
        seen_primes = set()
        for index in range(8):
            seed = f'public-output-{index}'
            payload = public_payload(seed)
            seen_primes.add(payload['public']['p'])
            for shape in (tuple, list):
                with self.subTest(seed=seed, shape=shape.__name__), patch.object(
                    reference, 'transfer', side_effect=lambda *args: shape(transfer(*args))
                ), patch.dict(os.environ, {'PUBLIC_EVIDENCE_JSON': json.dumps(payload)}), patch.object(
                    verifier, 'SEED', seed
                ), patch.object(server._WORKBENCH, 'sealing_key', verifier.workbench_sealing_key()):
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        public_test.part2()
                    answers = answer_texts(output.getvalue())
                    self.assertEqual(set(answers), set(server.CHECKPOINTS))
                    self.assertIsInstance(json.loads(answers['transfer']), list)
                    prepared = server._WORKBENCH.prepare_submissions(
                        server._WORKBENCH.starter_payload(), answers
                    )
                    self.assertTrue(prepared['ok'])
                    self.assertEqual(prepared['missingManual'], [])
                    handler = verifier.Handler.__new__(verifier.Handler)
                    handler.path = '/verify'
                    handler._respond = Mock()
                    for name, submission in prepared['submissions'].items():
                        handler._read_json_body = Mock(return_value={
                            'checkpointId': name, 'submission': submission
                        })
                        handler.do_POST()
                        handler._respond.assert_called_with(200, {'checkpointId': name, 'correct': True})
                    # Formatting fixes must not broaden the verifier's input grammar.
                    tuple_text = str(tuple(json.loads(answers['transfer'])))
                    invalid = server._WORKBENCH.prepare_submissions(
                        server._WORKBENCH.starter_payload(), {'transfer': tuple_text}
                    )
                    handler._read_json_body = Mock(return_value={
                        'checkpointId': 'transfer', 'submission': invalid['submissions']['transfer']
                    })
                    handler.do_POST()
                    handler._respond.assert_called_with(200, {'checkpointId': 'transfer', 'correct': False})
        self.assertEqual(seen_primes, {5, 7})


@unittest.skipUnless(os.environ.get('SCHNORR_WORKBENCH_URL'), 'requires a dedicated live Compose workbench')
class LivePublicOutput(unittest.TestCase):
    def call(self, path, payload=None):
        request = Request(os.environ['SCHNORR_WORKBENCH_URL'] + path,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def test_copy_from_real_public_runner_through_prepare_and_verify(self):
        reference = (ROOT / 'reference/schnorr_drill.py').read_text()
        starter = self.call('/api/starter')
        for shape in ('tuple', 'list'):
            with self.subTest(shape=shape):
                source = reference
                if shape == 'list':
                    source += '\n_original_transfer = transfer\ndef transfer(*args):\n    return list(_original_transfer(*args))\n'
                public = self.call('/api/test', {'files': {'schnorr_drill.py': source}})
                self.assertTrue(public['passed'], public['output'])
                answers = answer_texts(public['output'])
                self.assertEqual(set(answers), set(server.CHECKPOINTS))
                self.assertIsInstance(json.loads(answers['transfer']), list)
                prepared = self.call('/api/prepare', {'files': starter, 'manual': answers})
                self.assertTrue(prepared['ok'])
                self.assertEqual(prepared['missingManual'], [])
                for name, submission in prepared['submissions'].items():
                    self.assertEqual(self.call('/verify', {'checkpointId': name, 'submission': submission}),
                                     {'checkpointId': name, 'correct': True})
                invalid = self.call('/api/prepare', {'files': starter, 'manual': {
                    'transfer': str(tuple(json.loads(answers['transfer'])))
                }})
                self.assertEqual(self.call('/verify', {
                    'checkpointId': 'transfer', 'submission': invalid['submissions']['transfer']
                }), {'checkpointId': 'transfer', 'correct': False})
        config = self.call('/api/config')['i18n']['en']
        self.assertNotIn('challenge', config['description'])
        self.assertIn('question number', config['description'])
        for name in ('response', 'transfer'):
            self.assertNotIn('challenge', config['checkpointLabels'][name])
            self.assertIn('question number', config['checkpointLabels'][name])
        self.assertEqual(self.call('/healthz'), {'ok': True})


if __name__ == '__main__':
    unittest.main()
