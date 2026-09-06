"""Exercise the deployed Linux worker and parent grading boundary, with synthetic runs only."""
from __future__ import annotations

import ctypes
import errno
import json
import os
import sys
import subprocess
import signal
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fixtures.generate import public_payload
from participant import execution
from participant.isolation import protect_supervisor
from verifier import server

COUNTEREXAMPLES = '''
def inside(s):
    for w in range(s['lo'], s['hi']+1):
        if (s['a']*w+s['b']) % s['p'] == s['c']: return w
    raise ValueError('no valid value')
def incompleteness_witness(s): return inside(s)
def unsoundness_witness(s):
    w=inside(s)
    while w<=s['hi']: w+=s['p']
    return w
def extract_witness(t): return t['opening']['value']
'''


def public_sources(seed):
    public = public_payload(seed)
    matrix = {}
    for name, checks in public['verifiers'].items():
        matrix[name] = {
            'complete': 'range(strict-lo)' not in checks,
            'sound': 'range' in checks or 'range(strict-lo)' in checks,
            'private': name != public['privacyProtocol'],
        }
    return {'classify.py': f'def classify(name): return {matrix!r}[name]\n',
            'counterexamples.py': COUNTEREXAMPLES}


SCHEDULING_HELPER = r'''
"""Disposable parent; only its forked child can target this PID, then both exit."""
import ctypes,json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from participant.isolation import restrict_learner,protect_supervisor
protect_supervisor()
libc=ctypes.CDLL(None,use_errno=True)
seccomp=ctypes.CDLL('libseccomp.so.2')
numbers={name:seccomp.seccomp_syscall_resolve_name(name.encode()) for name in ('sched_setattr','ioprio_set','ioprio_get')}
assert all(number>=0 for number in numbers.values())
def snapshot():
    return {'policy':os.sched_getscheduler(0),'priority':os.sched_getparam(0).sched_priority,
            'nice':os.getpriority(os.PRIO_PROCESS,0),'affinity':sorted(os.sched_getaffinity(0)),
            'ioprio':libc.syscall(numbers['ioprio_get'],1,0)}
before=snapshot();parent=os.getpid();readfd,writefd=os.pipe()
pid=os.fork()
if pid==0:
    os.close(readfd)
    try:
        restrict_learner()
        class Param(ctypes.Structure):_fields_=[('priority',ctypes.c_int)]
        class Attr(ctypes.Structure):
            _fields_=[('size',ctypes.c_uint32),('policy',ctypes.c_uint32),('flags',ctypes.c_uint64),
                      ('nice',ctypes.c_int32),('priority',ctypes.c_uint32),('runtime',ctypes.c_uint64),
                      ('deadline',ctypes.c_uint64),('period',ctypes.c_uint64)]
        attr=Attr(ctypes.sizeof(Attr),5,0,19,0,0,0,0)
        param=Param(0)
        cpus=before['affinity'];size=max(cpus)//8+1
        mask=(ctypes.c_ubyte*size)();mask[cpus[0]//8]=1<<(cpus[0]%8)
        calls=[('sched_setscheduler',(parent,5,ctypes.byref(param))),
               ('sched_setparam',(parent,ctypes.byref(param))),
               ('syscall',(numbers['sched_setattr'],parent,ctypes.byref(attr),0)),
               ('sched_setaffinity',(parent,size,ctypes.byref(mask))),
               ('setpriority',(0,parent,19)),('syscall',(numbers['ioprio_set'],1,parent,3<<13))]
        results=[]
        for name,args in calls:
            ctypes.set_errno(0);result=getattr(libc,name)(*args)
            results.append([result,ctypes.get_errno()])
        read_allowed=(os.sched_getscheduler(parent)>=0 and os.sched_getparam(parent).sched_priority>=0
                      and os.getpriority(os.PRIO_PROCESS,parent)>=-20 and bool(os.sched_getaffinity(parent))
                      and libc.syscall(numbers['ioprio_get'],1,parent)>=0)
        os.write(writefd,json.dumps({'results':results,'read_allowed':read_allowed}).encode())
    finally:os._exit(0)
os.close(writefd)
data=b''
while True:
    block=os.read(readfd,4096)
    if not block:break
    data+=block
os.close(readfd);os.waitpid(pid,0)
print(json.dumps({'before':before,'after':snapshot(),'child':json.loads(data),'child_reaped':not Path('/proc',str(pid)).exists()}))
'''

@unittest.skipUnless(sys.platform == 'linux', 'deployed evaluator requires Linux seccomp')
class ExecutionBoundary(unittest.TestCase):
    def test_same_uid_child_cannot_change_disposable_parent_scheduling(self):
        process = subprocess.Popen(
            [sys.executable, '-I', '-c', SCHEDULING_HELPER, str(ROOT)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={'PATH':'/usr/local/bin:/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'},
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, stderr.decode())
            result = json.loads(stdout)
            self.assertEqual(result['child']['results'], [[-1,1]] * 6)
            self.assertTrue(result['child']['read_allowed'])
            self.assertEqual(result['before'], result['after'])
            self.assertTrue(result['child_reaped'])
        finally:
            # Even a failing legacy-policy replay never targets the test runner
            # or a live HTTP server, and the entire disposable group is removed.
            try:os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:pass
            process.wait()
        self.assertFalse(Path('/proc',str(process.pid)).exists())

    def test_system_v_and_posix_message_queues_cannot_survive_a_submission(self):
        paths = [Path('/proc/sysvipc') / name for name in ('shm', 'msg', 'sem')]
        before = [path.read_text() for path in paths]
        libc = ctypes.CDLL(None, use_errno=True)
        mq_unlink_number = ctypes.CDLL('libseccomp.so.2').seccomp_syscall_resolve_name(b'mq_unlink')
        self.assertGreaterEqual(mq_unlink_number, 0)
        source = '''import ctypes,os
def probe( arguments):
    name, unlink_number = arguments
    lib = ctypes.CDLL(None, use_errno=True)
    class Attr(ctypes.Structure):
        _fields_ = [('flags',ctypes.c_long),('maxmsg',ctypes.c_long),
                    ('msgsize',ctypes.c_long),('curmsgs',ctypes.c_long),
                    ('pad',ctypes.c_long*4)]
    attr = Attr(0, 1, 8, 0)
    calls = [('shmget',(0,4096,0o1600)), ('msgget',(0,0o1600)),
             ('semget',(0,1,0o1600)),
             ('mq_open',(name.encode(),os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600,ctypes.byref(attr))),
             ('shmat',(-1,None,0)), ('shmdt',(None,)), ('shmctl',(-1,0,None)),
             ('msgsnd',(-1,None,0,0)), ('msgrcv',(-1,None,0,0,0)), ('msgctl',(-1,0,None)),
             ('semop',(-1,None,0)), ('semtimedop',(-1,None,0,None)), ('semctl',(-1,0,0)),
             ('mq_unlink',(name.encode(),)), ('mq_timedsend',(-1,b'x',1,0,None)),
             ('mq_timedreceive',(-1,None,0,None,None)), ('mq_notify',(-1,None)),
             ('mq_getattr',(-1,ctypes.byref(attr))),
             ('syscall',(unlink_number,name[1:].encode()))]
    out = []
    for fn,args in calls:
        ctypes.set_errno(0)
        value = getattr(lib,fn)(*args)
        out.append([value,ctypes.get_errno()])
    return out
'''
        for attempt in range(64):
            name = '/constraint-ipc-' + uuid.uuid4().hex
            results = []
            try:
                result = execution.run_functions({'classify.py':'# unused','counterexamples.py':source},
                    [{'function':'probe','argument':[name,mq_unlink_number]}])
                self.assertIsNotNone(result)
                results = result['values'][0]
                expected = [[-1, errno.EPERM] for _ in range(19)]
                # glibc mq_unlink converts kernel EPERM to POSIX EACCES. The
                # final raw syscall verifies the underlying seccomp EPERM too.
                expected[13] = [-1, errno.EACCES]
                self.assertEqual(results, expected, attempt)
                self.assertEqual([path.read_text() for path in paths], before)
                self.assertFalse(Path('/dev/mqueue', name[1:]).exists())
            finally:
                # If a deny regresses, the test fails but still removes the three
                # tiny objects it created. Queue cleanup uses its unique name.
                for fn, result in zip(('shmctl', 'msgctl', 'semctl'), results):
                    if result[0] >= 0:
                        args = (result[0],0,0) if fn == 'semctl' else (result[0],0,None)
                        self.assertEqual(getattr(libc,fn)(*args), 0)
                ctypes.set_errno(0)
                removed = libc.mq_unlink(name.encode())
                self.assertTrue(removed == 0 or ctypes.get_errno() == errno.ENOENT)
        self.assertEqual([path.read_text() for path in paths], before)

    def test_posix_shared_memory_and_named_semaphore_creation_use_denied_file_opens(self):
        libc = ctypes.CDLL(None, use_errno=True)
        before = {path.name for path in Path('/dev/shm').iterdir()}
        source = '''import ctypes,os
def probe( names):
    lib = ctypes.CDLL(None, use_errno=True)
    lib.sem_open.restype = ctypes.c_void_p
    errors = []
    for fn,args in [('shm_open',(names[0].encode(),os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)),
                    ('sem_open',(names[1].encode(),os.O_CREAT|os.O_EXCL,0o600,1))]:
        ctypes.set_errno(0)
        getattr(lib,fn)(*args)
        errors.append(ctypes.get_errno())
    return errors
'''
        for attempt in range(64):
            names = ['/constraint-shm-' + uuid.uuid4().hex, '/constraint-sem-' + uuid.uuid4().hex]
            try:
                result = execution.run_functions({'classify.py':'# unused','counterexamples.py':source},
                    [{'function':'probe','argument':names}])
                self.assertIsNotNone(result)
                self.assertEqual(result['values'], [[errno.EPERM]*2])
                self.assertEqual({path.name for path in Path('/dev/shm').iterdir()}, before)
            finally:
                for fn,name in zip(('shm_unlink','sem_unlink'),names):
                    ctypes.set_errno(0)
                    removed = getattr(libc,fn)(name.encode())
                    self.assertTrue(removed == 0 or ctypes.get_errno() == errno.ENOENT)
        self.assertEqual({path.name for path in Path('/dev/shm').iterdir()}, before)

    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_public_aliases_work_on_unseen_numbers_across_runs(self):
        for seed in ('reader-one', 'reader-two', 'reader-three'):
            with self.subTest(seed=seed), patch.object(server, 'SEED', seed):
                files = public_sources(seed)
                result = server.prepare_submissions(seed, files)
                self.assertTrue(result['ok'])
                for checkpoint, submission in result['submissions'].items():
                    self.assertTrue(server.evaluate(checkpoint, submission)[0], checkpoint)
                # They know only this deployment's names, not the hidden seed's aliases.
                self.assertNotEqual(set(public_payload(seed)['verifiers']),
                                    set(public_payload(seed+':transfer')['verifiers']))

    def test_child_cannot_declare_the_verdict_or_import_the_checker(self):
        for source in (
            'import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
            'from fixtures.generate import TRUTH\ndef classify(p):return TRUTH[p]',
            'import os\nprint(\'{"values": [true,true,true,true,true,true,true,true,true,true,true,true]}\',flush=True)\nos._exit(0)',
            'import sys\nsys.modules["tests.hidden.check_properties"].run=lambda *a:[]',
        ):
            with self.subTest(source=source):
                files = public_sources('boundary-negative')
                files['classify.py'] = source
                self.assertFalse(server._check_transfer(files)[0])

    def test_open_network_exec_and_all_process_environments_are_inaccessible(self):
        source = '''import os,sys,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def classify(_):
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',
           '/problem/tests/hidden/check_properties.py']
    paths += ['/proc/'+p+'/environ' for p in _]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0:
            readable=True
            os.close(fd)
    fd=libc.socket(2,1,0)
    network=fd>=0
    if network: os.close(fd)
    try:
        os.execv('/bin/true',['/bin/true'])
        exec_allowed=True
    except OSError: exec_allowed=False
    return {'seed_present':'FLAG_SEED' in os.environ, 'private_file_readable':readable,
            'network_allowed':network,'exec_allowed':exec_allowed,
            'checker_loaded':any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)}
'''
        result = execution.run_functions({'classify.py': source, 'counterexamples.py': ''},
                                         [{'function': 'classify', 'argument': [p.name for p in Path('/proc').iterdir() if p.name.isdigit()]}])
        self.assertEqual(result['values'], [dict(seed_present=False, private_file_readable=False,
                         network_allowed=False, exec_allowed=False, checker_loaded=False)])

    def test_same_uid_learner_cannot_signal_or_modify_supervisor(self):
        source = '''import os,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def classify(_):
    pid=os.getppid()
    signal_denied=libc.kill(pid,0)==-1
    class Limit(ctypes.Structure): _fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    limit_denied=libc.prlimit64(pid,1,ctypes.byref(limit),None)==-1
    return [signal_denied,limit_denied]
'''
        result = execution.run_functions({'classify.py': source, 'counterexamples.py': ''},
                                         [{'function': 'classify', 'argument': ''}])
        self.assertEqual(result['values'], [[True, True]])

    def test_timeout_and_success_clean_forked_children(self):
        fork = '''import os
def classify(_):
    pid=os.fork()
    if pid==0:
        while True: pass
    return pid
'''
        result = execution.run_functions({'classify.py': fork, 'counterexamples.py': ''},
                                         [{'function': 'classify', 'argument': ''}])
        pid = result['values'][0]
        for _ in range(50):
            status = Path(f'/proc/{pid}/stat')
            if not status.exists() or status.read_text().split()[2] == 'Z':
                break
            time.sleep(.02)
        else:
            self.fail('forked learner remains running after successful response')
        spin = 'while True: pass\n'
        with patch.object(execution, 'RUN_TIMEOUT_SECONDS', .2):
            start = time.monotonic()
            result = execution.run_functions({'classify.py': spin, 'counterexamples.py': ''}, [])
            self.assertIsNone(result)
            self.assertLess(time.monotonic()-start, 3)

    def test_failed_prepare_does_not_echo_unseen_values(self):
        files = public_sources('prepare-private')
        files['counterexamples.py'] = '''
def incompleteness_witness(s):
    print('UNSEEN_INPUT:'+str(s),flush=True)
    raise RuntimeError('UNSEEN_INPUT:'+str(s))
'''
        result = server.prepare_submissions('prepare-private', files)
        self.assertFalse(result['ok'])
        self.assertNotIn('UNSEEN_INPUT', json.dumps(result))

    def test_fixed_displayed_answers_do_not_transfer(self):
        seed='fixed-answer-negative'
        with patch.object(server,'SEED',seed):
            good=public_sources(seed)
            prepared=server.prepare_submissions(seed,good)['submissions']
            files=dict(good)
            files['counterexamples.py']=(
                'def incompleteness_witness(s):return '+prepared['incompleteness']+'\n'
                'def unsoundness_witness(s):return '+prepared['unsoundness']+'\n'
                'def extract_witness(t):return '+prepared['privacy-leak']+'\n')
            self.assertFalse(server._check_transfer(files)[0])


class IntegerContract(unittest.TestCase):
    def test_numeric_answers_reject_boolean_and_fraction(self):
        for value in (True,False,3.5,[],{}):
            self.assertIsNone(server._normalized_int(value))
        self.assertEqual(server._normalized_int(' -3 '), -3)


if __name__ == '__main__':
    unittest.main()
