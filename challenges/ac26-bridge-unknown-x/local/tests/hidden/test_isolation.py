"""Linux-only author checks of the actual learner launcher; never shipped to learners."""
import json,os,sys,unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant import server
from participant.isolation import protect_supervisor
from verifier.server import public_payload
PROBE=r'''
import ctypes,json,os,socket,subprocess,sys
print('SEED_ABSENT','FLAG_SEED' not in os.environ)
print('PUBLIC_URL',os.environ.get('VERIFIER_PUBLIC_URL','absent'))
print('VERIFY_URL',os.environ.get('VERIFIER_URL','absent'))
print('PUBLIC_ONLY',set(json.loads(os.environ['PUBLIC_EVIDENCE_JSON']))=={'public','assignments'})
for family in (socket.AF_INET,socket.AF_INET6,socket.AF_UNIX):
    try: socket.socket(family,socket.SOCK_STREAM);print('ESCAPE_SOCKET')
    except OSError as error: print('SOCKET_DENIED',error.errno)
libc=ctypes.CDLL(None,use_errno=True)
print('NATIVE_SOCKET',libc.socket(2,1,0),ctypes.get_errno())
for name in ('mem','environ'):
    try:
        with open('/proc/'+str(os.getppid())+'/'+name,'rb') as f: f.read(1)
        print('ESCAPE_PARENT',name)
    except OSError:print('PARENT_DENIED',name)
child='import socket\ntry: socket.socket(); print("ESCAPE_CHILD")\nexcept OSError as e: print("CHILD_DENIED",e.errno)'
print(subprocess.check_output([sys.executable,'-c',child],text=True))
'''
@unittest.skipUnless(sys.platform=='linux','requires the real Linux container restriction')
class Isolation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()
        server._WORKBENCH.public_payload=public_payload('isolation-public-example')
    def test_learner_cannot_read_seed_parent_or_network(self):
        source=(ROOT/'starter/unknown_x_drill.py').read_text()+PROBE
        result=server._WORKBENCH.run_public_tests({'unknown_x_drill.py':source})
        self.assertFalse(result['passed'])
        for marker in ('SEED_ABSENT True','PUBLIC_URL absent','VERIFY_URL absent','PUBLIC_ONLY True','NATIVE_SOCKET -1 1','PARENT_DENIED mem','PARENT_DENIED environ','CHILD_DENIED 1'):
            self.assertIn(marker,result['output'])
        self.assertEqual(result['output'].count('SOCKET_DENIED 1'),3)
        self.assertNotIn('ESCAPE_',result['output'])
    def test_inspect_uses_the_public_snapshot(self):
        output=server._WORKBENCH.inspect_payload()['output']
        self.assertIn(server._WORKBENCH.public_payload['assignments'],output)
        self.assertNotIn('Traceback',output)
    def test_failed_filter_does_not_execute_learner(self):
        source=(ROOT/'starter/unknown_x_drill.py').read_text()+"\nprint('LEARNER_EXECUTED')\n"
        with patch.object(server,'block_network',side_effect=RuntimeError('unavailable filter')):
            result=server._WORKBENCH.run_public_tests({'unknown_x_drill.py':source})
        self.assertFalse(result['passed']);self.assertNotIn('LEARNER_EXECUTED',result['output'])

@unittest.skipUnless(os.environ.get('UNKNOWN_X_WORKBENCH_URL'), 'requires the dedicated live Compose workbench')
class LiveProcessIsolation(unittest.TestCase):
    def call(self, path, payload=None):
        request = Request(os.environ['UNKNOWN_X_WORKBENCH_URL'] + path,
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def test_all_process_environments_including_init_and_healthchecks_are_seed_free(self):
        # Only boolean presence is returned; even a failing regression never prints values.
        probe = r'''
import json,time
from pathlib import Path
observed={}
until=time.monotonic()+5
while time.monotonic()<until:
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():continue
        try:
            raw=(process/'environ').read_bytes()
            secret=any(entry.startswith((b'FLAG_SEED=',b'WORKBENCH_SEAL_KEY=')) for entry in raw.split(bytes([0])))
            observed[process.name]={'readable':True,'secret_present':secret}
        except OSError:
            observed.setdefault(process.name,{'readable':False,'secret_present':False})
    time.sleep(0.005)
print('ALL_PROC_ENV',json.dumps(observed,sort_keys=True))
'''
        starter = self.call('/api/starter')
        result = self.call('/api/test', {'files': {'unknown_x_drill.py': starter['unknown_x_drill.py'] + probe}})
        lines = [line for line in result['output'].splitlines() if line.startswith('ALL_PROC_ENV ')]
        self.assertEqual(len(lines), 1)
        observed = json.loads(lines[0].removeprefix('ALL_PROC_ENV '))
        self.assertIn('1', observed)
        self.assertGreaterEqual(len(observed), 4)  # init, supervisor, learner, and a healthcheck
        self.assertFalse(any(process['secret_present'] for process in observed.values()))
        print('LIVE_ALL_PROC_ENV', json.dumps(observed, sort_keys=True))

    def test_private_key_route_is_not_a_public_proxy_route(self):
        for path in ('/workbench-key', '/api/workbench-key', '/verify/workbench-key'):
            for payload in (None, {'checkpointId': 'covered', 'submission': 'x'}):
                with self.assertRaises(HTTPError) as caught:
                    self.call(path, payload)
                self.assertEqual(caught.exception.code, 404)
                caught.exception.close()

if __name__=='__main__':unittest.main()
