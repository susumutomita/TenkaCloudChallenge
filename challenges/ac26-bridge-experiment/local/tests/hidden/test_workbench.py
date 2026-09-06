"""Author checks for the public Workbench, not a malicious-code sandbox claim."""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant import server


class PublicProcess(unittest.TestCase):
    def test_public_tests_do_not_receive_the_author_seed(self):
        source = server.starter_payload()['counter.py'] + "\nimport os\nprint('SEED_PRESENT', 'FLAG_SEED' in os.environ)\n"
        with patch.object(server, 'SEED', 'public-process-synthetic-example'):
            result = server.run_public_tests({'counter.py': source})
        self.assertIn('SEED_PRESENT False', result['output'])
        self.assertNotIn('SEED_PRESENT True', result['output'])
        self.assertFalse(result['passed'])  # The original unfinished advance still fails.


@unittest.skipUnless(os.environ.get('BRIDGE_WORKBENCH_URL'), 'requires a dedicated live Compose workbench')
class LiveWorkbench(unittest.TestCase):
    def call(self, path, payload=None):
        request = Request(os.environ['BRIDGE_WORKBENCH_URL'] + path,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=20) as response:
            return json.load(response)

    def test_all_visible_workbench_process_environments_are_seed_free(self):
        # Healthchecks inherit the container's configured environment too. Report
        # only presence, never environment values, even if this regression fails.
        probe = r'''
import json,os,time
from pathlib import Path
seen={}
until=time.monotonic()+5
while time.monotonic()<until:
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:
            raw=(p/'environ').read_bytes()
            seen[p.name]=any(entry.startswith(b'FLAG_SEED=') for entry in raw.split(bytes([0])))
        except OSError:pass
    time.sleep(0.005)
print('SEED_ENV', 'FLAG_SEED' in os.environ)
print('PROC_SEED',json.dumps(seen,sort_keys=True))
print('ANSWER_FILES',any(Path('/problem',p).exists() for p in ('fixtures','verifier','reference','tests/hidden')))
'''
        files = self.call('/api/starter')
        files['counter.py'] += probe
        result = self.call('/api/test', {'files': files})
        self.assertIn('SEED_ENV False', result['output'])
        self.assertIn('ANSWER_FILES False', result['output'])
        line, = [line for line in result['output'].splitlines() if line.startswith('PROC_SEED ')]
        seen = json.loads(line.removeprefix('PROC_SEED '))
        self.assertIn('1', seen)
        self.assertGreaterEqual(len(seen), 3)  # supervisor, learner, healthcheck
        self.assertFalse(any(seen.values()))
        print('LIVE_PROC_SEED_PRESENT', json.dumps(seen, sort_keys=True))

    def test_prepare_supplies_only_the_documented_automatic_fields(self):
        files = self.call('/api/starter')
        public = self.call('/api/inspect')
        result = self.call('/api/prepare', {'files': files})
        self.assertTrue(result['ok'])
        submissions = result['submissions']
        self.assertEqual(set(submissions), {'environment', 'generalize', 'count-no-walkback'})
        self.assertEqual(submissions['environment'], public['environment']['healthToken'])
        self.assertEqual(submissions['generalize'], files['counter.py'])
        self.assertEqual(submissions['count-no-walkback'], files['counter.py'])


if __name__ == '__main__':
    unittest.main()
