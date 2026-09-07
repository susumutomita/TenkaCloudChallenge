"""The supplied context checker must reject malformed JSON shapes, not crash."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / name / 'assertion.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')

class ContextShapeTest(unittest.TestCase):
    def test_non_object_json_is_rejected_before_field_access(self):
        for module in [load('starter'), load('reference')]:
            for value in [[], None, 1, 'text', True]:
                assertion = {'authenticatorData': encode(bytes(37)),
                             'clientDataJSON': encode(json.dumps(value).encode())}
                self.assertEqual(module._context_failure({}, assertion), 'malformed-assertion')
            self.assertEqual(module._context_failure({}, None), 'malformed-assertion')

    def test_missing_signature_fails_without_crashing(self):
        module = load('reference')
        record = {'credentialId': 'example', 'rpId': 'example.test',
                  'expectedOrigin': 'https://example.test', 'expectedChallenge': 'request',
                  'publicKey': {}}
        client = {'origin': record['expectedOrigin'], 'challenge': 'request', 'type': 'webauthn.get'}
        assertion = {'id': 'example',
                     'authenticatorData': encode(hashlib.sha256(b'example.test').digest()+bytes([5,0,0,0,0])),
                     'clientDataJSON': encode(json.dumps(client).encode())}
        self.assertIsNone(module._context_failure(record, assertion))
        self.assertEqual(module.verify_assertion(record, assertion), {'ok': False, 'reason': 'signature-invalid'})

if __name__ == '__main__':
    unittest.main()
