"""The public Workbench receives a derived key, never the fixture seed."""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant import server
from verifier import server as verifier


class Bootstrap(unittest.TestCase):
    def test_seals_keep_the_existing_verifier_contract(self):
        for seed in ('bootstrap-example-a', 'bootstrap-example-b'):
            with patch.object(verifier, 'SEED', seed), patch.object(
                server._WORKBENCH, 'sealing_key', verifier.workbench_sealing_key()
            ):
                token = server._WORKBENCH._seal_manual('field-inv', 3)
                self.assertEqual(verifier._unwrap_submission('field-inv', token), 3)
                self.assertIsNone(verifier._unwrap_submission('order', token))
                self.assertIsNone(verifier._unwrap_submission('field-inv', '3'))
                with patch.object(verifier, 'SEED', seed + '-other-run'):
                    self.assertIsNone(verifier._unwrap_submission('field-inv', token))

    def test_no_default_key_can_prepare_a_submission(self):
        with patch.object(server._WORKBENCH, 'sealing_key', None):
            with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                server._WORKBENCH._seal_manual('field-inv', 3)

    def test_key_fetch_uses_a_fixed_internal_path(self):
        with patch.object(server, 'VERIFIER_URL', 'http://verifier:18138/verify?extra=1'), patch.object(
            server, 'urlopen', return_value=io.BytesIO(json.dumps({'key': 'ab' * 32}).encode())
        ) as fetch:
            self.assertEqual(server.load_sealing_key(), bytes.fromhex('ab' * 32))
            fetch.assert_called_once_with(
                'http://verifier:18138/workbench-key', timeout=server.REQUEST_TIMEOUT_SECONDS
            )

    def test_invalid_or_missing_key_aborts_bootstrap(self):
        invalid = [{}, [], {'key': None}, {'key': 'ab'}, {'key': 'zz' * 32}, {'key': ' ' * 64}]
        with patch.object(server, 'VERIFIER_URL', 'http://verifier:18138/verify'):
            for payload in invalid:
                with patch.object(server, 'urlopen', return_value=io.BytesIO(json.dumps(payload).encode())):
                    with self.assertRaises(RuntimeError):
                        server.load_sealing_key()
            with patch.object(server, 'urlopen', return_value=io.BytesIO(b' ' * 1025)):
                with self.assertRaises(RuntimeError):
                    server.load_sealing_key()

    def test_supervisor_is_protected_before_key_fetch_and_no_listener_on_failure(self):
        order = []
        with patch.object(server, 'protect_supervisor', side_effect=lambda: order.append('protected')), patch.object(
            server, 'load_sealing_key', side_effect=lambda: order.append('key') or b'x' * 32
        ), patch.object(server, 'load_public_snapshot', return_value={'public': {}}), patch.object(
            server, 'HTTPServer', side_effect=lambda *args: order.append('listen') or Mock()
        ), patch.object(server._WORKBENCH, 'sealing_key'), patch.object(server._WORKBENCH, 'public_payload'):
            server.main()
        self.assertEqual(order, ['protected', 'key', 'listen'])
        with patch.object(server, 'protect_supervisor'), patch.object(
            server, 'load_sealing_key', side_effect=RuntimeError('unavailable')
        ), patch.object(server, 'HTTPServer') as listener:
            with self.assertRaises(RuntimeError):
                server.main()
            listener.assert_not_called()

    def test_public_routes_never_relay_the_private_key_path(self):
        handler = server.Handler.__new__(server.Handler)
        handler._respond = Mock()
        handler._read_json_body = Mock()
        for path in ('/workbench-key', '/api/workbench-key', '/verify/workbench-key'):
            handler.path = path
            handler.do_GET()
            handler._respond.assert_called_with(404, {'error': 'not found'})
            handler.do_POST()
            handler._respond.assert_called_with(404, {'error': 'not found'})
        handler._read_json_body.assert_not_called()

    def test_verify_proxy_cannot_select_a_different_internal_path(self):
        with patch.object(
            server, 'urlopen', return_value=io.BytesIO(b'{"checkpointId":"field-inv","correct":false}')
        ) as fetch:
            server.proxy_verdict(
                {'checkpointId': 'field-inv', 'submission': 'x', 'url': '/workbench-key'},
                'http://verifier:18138/verify',
            )
            self.assertEqual(fetch.call_args.args[0].full_url, 'http://verifier:18138/verify')

    def test_verifier_public_payload_does_not_include_bootstrap_material(self):
        handler = verifier.Handler.__new__(verifier.Handler)
        handler._respond = Mock()
        with patch.object(verifier, 'SEED', 'bootstrap-public-example'):
            handler.path = '/public'
            handler.do_GET()
            payload = handler._respond.call_args.args[1]
            self.assertEqual(set(payload), {'public', 'pointKeys', 'assignments', 'lines'})
            serialized = json.dumps(payload)
            self.assertNotIn(verifier.SEED, serialized)
            self.assertNotIn(verifier.workbench_sealing_key().hex(), serialized)

    def test_compose_injects_seed_only_into_the_verifier(self):
        compose = (ROOT / 'docker-compose.yml').read_text()
        workbench, verifier_service = compose.split('\n  verifier:', 1)
        self.assertNotIn('FLAG_SEED', workbench)
        self.assertIn('FLAG_SEED: ${FLAG_SEED:?', verifier_service)


if __name__ == '__main__':
    unittest.main()
