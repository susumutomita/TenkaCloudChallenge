"""Linux/Docker regression: use the actual Workbench launcher and CLI launcher."""
from pathlib import Path
import json,os,subprocess,sys,tempfile,time,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant import server
FILENAME='rotation_drill.py'
PROBE=r'''
import ctypes,json,os,resource,signal,socket,subprocess,sys
print('PUBLIC_URL',os.environ.get('VERIFIER_PUBLIC_URL','absent'))
print('VERIFY_URL',os.environ.get('VERIFIER_URL','absent'))
print('SEED',os.environ.get('FLAG_SEED','absent'))
print('PRIVATE_TAG','submissionBinding' in json.loads(os.environ['PUBLIC_EVIDENCE_JSON']))
for family in (socket.AF_INET,socket.AF_INET6,socket.AF_UNIX):
    try: socket.socket(family,socket.SOCK_STREAM);print('ESCAPE_SOCKET')
    except OSError as error: print('SOCKET_DENIED',error.errno)
libc=ctypes.CDLL(None,use_errno=True)
print('NATIVE_SOCKET',libc.socket(2,1,0),ctypes.get_errno())
try:
    fd=os.open('/proc/'+str(os.getppid())+'/mem',os.O_RDWR)
    print('ESCAPE_MEMORY');os.close(fd)
except OSError: print('MEMORY_DENIED')
for operation in (
    lambda: os.kill(os.getppid(),signal.SIGKILL),
    lambda: resource.prlimit(os.getppid(),resource.RLIMIT_NOFILE,(1,1)),
    lambda: os.setsid(),
    lambda: os.setpgid(0,0),
):
    try: operation(); print('ESCAPE_PROCESS')
    except OSError as error: print('PROCESS_DENIED',error.errno)
child='import socket\ntry: socket.socket(); print("ESCAPE_CHILD")\nexcept OSError as e: print("CHILD_DENIED",e.errno)'
print(subprocess.check_output([sys.executable,'-c',child],text=True))
'''


class NetworkIsolation(unittest.TestCase):
    def assert_isolated(self,output):
        for marker in ('PUBLIC_URL absent','VERIFY_URL absent','SEED absent','PRIVATE_TAG False','NATIVE_SOCKET -1 1','MEMORY_DENIED','CHILD_DENIED 1'):
            self.assertIn(marker,output)
        self.assertEqual(output.count('SOCKET_DENIED 1'),3,output)
        self.assertEqual(output.count('PROCESS_DENIED 1'),4,output)
        self.assertNotIn('ESCAPE_',output)

    def test_workbench_blocks_python_native_and_child_network_access(self):
        source=(ROOT/'starter'/FILENAME).read_text()+PROBE
        result=server._WORKBENCH.run_public_tests({FILENAME:source})
        self.assertFalse(result['passed'])  # the starter is intentionally unfilled
        self.assert_isolated(result['output'])

    def test_cli_uses_the_same_restriction_before_importing_learner_code(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory)/FILENAME).write_text((ROOT/'starter'/FILENAME).read_text()+PROBE)
            payload={key:server.PUBLIC_SNAPSHOT[key] for key in ('assignments','public')}
            env={**os.environ,'PARTICIPANT_STARTER_DIR':directory,'PUBLIC_EVIDENCE_JSON':json.dumps(payload),'FLAG_SEED':'must-not-forward','VERIFIER_URL':'http://invalid.test/verify','VERIFIER_PUBLIC_URL':'http://invalid.test/public'}
            result=subprocess.run([sys.executable,str(ROOT/'participant/cli_test.py')],env=env,capture_output=True,text=True,timeout=20,close_fds=True)
            self.assertNotEqual(result.returncode,0)
            self.assert_isolated(result.stdout+result.stderr)

    def test_exited_run_does_not_leave_running_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            result=server._WORKBENCH._run_process(
                [sys.executable,'-c',
                 'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"]); print(p.pid,flush=True)'],
                cwd=Path(directory),env=server._WORKBENCH._child_env(),timeout=5)
            self.assertIsNotNone(result)
            self.assertEqual(result[0],0)
            descendant=int(result[1].strip())
            for _ in range(40):
                try:
                    state=Path(f'/proc/{descendant}/stat').read_text().split(') ',1)[1][0]
                except FileNotFoundError:
                    return
                if state=='Z':  # Compose init reaps orphans; author container has no init.
                    return
                time.sleep(.05)
            self.fail(f'learner descendant {descendant} remains running')

    def test_inspect_prints_the_prefetched_assignments(self):
        output=server._WORKBENCH.inspect_payload()['output']
        self.assertIn(server.PUBLIC_SNAPSHOT['assignments'],output)
        self.assertNotIn('Traceback',output)


    def test_failed_filter_prevents_learner_execution(self):
        source=(ROOT/'starter'/FILENAME).read_text()+"\nprint('LEARNER_EXECUTED')\n"
        with patch.object(server,'block_network',side_effect=RuntimeError('filter unavailable')):
            result=server._WORKBENCH.run_public_tests({FILENAME:source})
        self.assertFalse(result['passed'])
        self.assertNotIn('LEARNER_EXECUTED',result['output'])


if __name__=='__main__':unittest.main()
