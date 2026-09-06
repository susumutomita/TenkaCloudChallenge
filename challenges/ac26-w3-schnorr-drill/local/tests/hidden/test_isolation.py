"""Linux-only author checks of the actual learner launcher; never shipped to learners."""
import json,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant import server
from participant.isolation import protect_supervisor
from fixtures.generate import public_payload
PROBE=r'''
import ctypes,json,os,socket,subprocess,sys
print('SEED',os.environ.get('FLAG_SEED','absent'))
print('PUBLIC_URL',os.environ.get('VERIFIER_PUBLIC_URL','absent'))
print('VERIFY_URL',os.environ.get('VERIFIER_URL','absent'))
print('PUBLIC_ONLY',set(json.loads(os.environ['PUBLIC_EVIDENCE_JSON']))=={'public','pointKeys','assignments','lines'})
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
        source=(ROOT/'starter/schnorr_drill.py').read_text()+PROBE
        result=server._WORKBENCH.run_public_tests({'schnorr_drill.py':source})
        self.assertFalse(result['passed'])
        for marker in ('SEED absent','PUBLIC_URL absent','VERIFY_URL absent','PUBLIC_ONLY True','NATIVE_SOCKET -1 1','PARENT_DENIED mem','PARENT_DENIED environ','CHILD_DENIED 1'):
            self.assertIn(marker,result['output'])
        self.assertEqual(result['output'].count('SOCKET_DENIED 1'),3)
        self.assertNotIn('ESCAPE_',result['output'])
    def test_inspect_uses_the_public_snapshot(self):
        output=server._WORKBENCH.inspect_payload()['output']
        self.assertIn(server._WORKBENCH.public_payload['assignments'],output)
        self.assertNotIn('Traceback',output)
    def test_failed_filter_does_not_execute_learner(self):
        source=(ROOT/'starter/schnorr_drill.py').read_text()+"\nprint('LEARNER_EXECUTED')\n"
        with patch.object(server,'block_network',side_effect=RuntimeError('unavailable filter')):
            result=server._WORKBENCH.run_public_tests({'schnorr_drill.py':source})
        self.assertFalse(result['passed']);self.assertNotIn('LEARNER_EXECUTED',result['output'])
if __name__=='__main__':unittest.main()
