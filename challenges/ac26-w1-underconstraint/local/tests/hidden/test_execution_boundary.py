"""Local, synthetic checks for the isolated worker and authoritative parent verdict."""
import json
import os
import sys
import subprocess
import signal
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fixtures.generate import params
from participant import execution
from participant.isolation import protect_supervisor
from verifier import server

REFERENCE = (ROOT / 'reference/policy.py').read_text()


class DiagnosisValues(unittest.TestCase):
    def test_only_canonical_integer_changes_are_a_diagnosis(self):
        for seed in ('diagnosis-a', 'diagnosis-b', 'diagnosis-c', 'diagnosis-d'):
            with patch.object(server, 'SEED', seed):
                answer = server._expected_root_cause(seed)
                self.assertTrue(server._check_root_cause(answer))
                for value in (True, False, 0.5, None, [], {}, '0', -1, params(seed)['p']):
                    bad = json.loads(json.dumps(answer))
                    bad['manipulatedSignals'][0]['after'] = value
                    self.assertFalse(server._check_root_cause(bad), type(value).__name__)
                if answer['missingConstraintId'] == 'c-iszero-a':
                    change = answer['manipulatedSignals'][0]
                    change['after'] = (change['before'] + 1) % params(seed)['p']
                    self.assertTrue(server._check_root_cause(answer))


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

@unittest.skipUnless(sys.platform == 'linux', 'deployed worker uses Linux process isolation')
class WorkerBoundary(unittest.TestCase):
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

    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_real_source_passes_all_five_code_checkpoints(self):
        for seed in ('local-one', 'local-two'):
            with patch.object(server, 'SEED', seed):
                for checkpoint in server.CODE_CHECKPOINTS:
                    self.assertTrue(server.evaluate(checkpoint, REFERENCE)[0], checkpoint)

    def test_stdout_and_zero_exit_cannot_declare_a_verdict(self):
        for source in ('import os\nprint(\'{"failures": []}\',flush=True)\nos._exit(0)',
                       'import os\nprint(\'{"values": [{"returned": []}]}\',flush=True)\nos._exit(0)',
                       'from tests.hidden import check_policy\ncheck_policy.run=lambda *args:[]',
                       'import sys\nsys.modules["tests.hidden.check_policy"].run=lambda *args:[]'):
            for checkpoint in server.CODE_CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint, source)[0], checkpoint)

    def test_persistent_ipc_is_denied_without_remaining_objects(self):
        paths=[Path('/proc/sysvipc')/name for name in ('shm','msg','sem')]
        before=[path.read_text() for path in paths]
        source='''import ctypes
def probe():
    libc=ctypes.CDLL(None,use_errno=True)
    calls=[('shmget',(0,4096,0o1600)),('shmat',(-1,None,0)),
           ('shmctl',(-1,0,None)),('msgget',(0,0o1600)),('msgctl',(-1,0,None)),
           ('semget',(0,1,0o1600)),('semctl',(-1,0,0)),('semop',(-1,None,0))]
    results=[]
    for name,args in calls:
        ctypes.set_errno(0)
        result=getattr(libc,name)(*args)
        results.append([result,ctypes.get_errno()])
    return results
'''
        for _ in range(16):
            result=execution.run_functions({'policy.py':source},[{'function':'probe','args':[]}])
            self.assertEqual(result['values'],[{'returned':[[-1,1]]*8}])
        self.assertEqual([path.read_text() for path in paths],before)

    def test_correct_static_batch_without_functions_is_rejected(self):
        # These are the five publicly documented dictionaries, not secret fixtures.
        namespace = {}
        exec(compile(REFERENCE, '<trusted reference>', 'exec'), namespace)
        intended = namespace['intended_circuit']()
        old_batch = json.dumps({'values': [{'returned': intended}]})
        source = 'import os\nprint(' + repr(old_batch) + ',flush=True)\nos._exit(0)\n'
        self.assertFalse(server.evaluate('build', source)[0])
        fixed_reply = json.dumps({'callId': 1, 'result': {'returned': intended}})
        source = 'import os\nprint(\'{"ready":true}\',flush=True)\nprint(' + repr(fixed_reply) + ',flush=True)\nos._exit(0)\n'
        self.assertFalse(server.evaluate('build', source)[0])

    def test_call_ids_are_fresh_and_not_given_during_initialization(self):
        source = '''import sys
initial = sys._getframe(1).f_locals['payload']
initial_had_calls = 'calls' in initial or 'callId' in initial

def intended_circuit():
    return [initial_had_calls, sys._getframe(1).f_locals['call']['callId']]
'''
        calls=[{'function':'intended_circuit','args':[]}] * 3
        result=execution.run_functions({'policy.py':source},calls)
        ids=[]
        for value in result['values']:
            initial_had_calls,call_id=value['returned']
            self.assertFalse(initial_had_calls)
            self.assertRegex(call_id,r'^[0-9a-f]{32}$')
            ids.append(call_id)
        self.assertEqual(len(set(ids)),3)

    def test_wrong_or_reused_id_and_partial_eof_never_complete_a_batch(self):
        for mode in ('wrong','reused','eof'):
            source = '''import json,os,sys
print('{"ready":true}',flush=True)
first=json.loads(sys.stdin.readline())
'''
            if mode=='wrong':
                source += "print(json.dumps({'callId':'0'*32,'result':{'returned':[]}}),flush=True)\nos._exit(0)\n"
            else:
                source += "print(json.dumps({'callId':first['callId'],'result':{'returned':[]}}),flush=True)\n"
                source += 'second=json.loads(sys.stdin.readline())\n'
                if mode=='reused':
                    source += "print(json.dumps({'callId':first['callId'],'result':{'returned':[]}}),flush=True)\n"
                source += 'os._exit(0)\n'
            result=execution.run_functions({'policy.py':source},[{'function':'intended_circuit','args':[]}] * 2)
            self.assertTrue(result is None or result['values'] is None,mode)

    def test_unterminated_and_excessive_output_obey_one_deadline(self):
        for source in ('import os\nos.write(1,b\'{"ready":\')\nwhile True:pass',
                       'print("x"*70000,flush=True)\nwhile True:pass',
                       'print("["*2000+"0"+"]"*2000,flush=True)\nwhile True:pass'):
            with patch.object(execution,'RUN_TIMEOUT_SECONDS',.2):
                start=time.monotonic()
                self.assertIsNone(execution.run_functions({'policy.py':source},[]))
                self.assertLess(time.monotonic()-start,3)

    def test_blocked_input_is_bounded_by_the_same_deadline(self):
        source = 'print(\'{"ready":true}\',flush=True)\nwhile True:pass'
        with patch.object(execution,'RUN_TIMEOUT_SECONDS',.2):
            start=time.monotonic()
            result=execution.run_functions({'policy.py':source},[{'function':'intended_circuit','args':['x'*200000]}])
            self.assertIsNone(result)
            self.assertLess(time.monotonic()-start,3)

    def test_repeated_fork_calls_leave_no_child_or_zombie(self):
        baseline={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        source = REFERENCE + '\nimport os\nfor _ in range(4):\n    if os.fork()==0:os._exit(0)\n'
        for attempt in range(64):
            self.assertTrue(server.evaluate('build',source)[0],attempt)
            for _ in range(200):
                extra={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}-baseline
                if not extra:break
                time.sleep(.01)
            self.assertEqual(extra,set(),f'unreaped processes after request {attempt+1}')

    def test_checkpoint_independence_survives_unrelated_function_errors(self):
        source = REFERENCE + '\ndef audit(circuit): raise NotImplementedError()\ndef repair(circuit): raise NotImplementedError()\n'
        self.assertTrue(server.evaluate('build', source)[0])
        self.assertTrue(server.evaluate('exploit', REFERENCE + '\ndef repair(circuit): raise NotImplementedError()\n')[0])
        self.assertFalse(server.evaluate('audit', source)[0])

    def test_build_requires_every_documented_dictionary(self):
        # A and B alone accept both honest fixtures and reject known forgeries,
        # but leave the independent boolean and grant checks unconstrained.
        for index in range(5):
            source = REFERENCE + f'\ndef intended_circuit(): return [dict(c) for i,c in enumerate(INTENDED) if i != {index}]\n'
            self.assertFalse(server.evaluate('build', source)[0], index)
        for replacement in (
            "result[2]['id']='different-id'",
            "result[0]['signal']='ok'",
            "result[0]=dict(result[1])",
        ):
            source = REFERENCE + '\ndef intended_circuit():\n    result=[dict(c) for c in INTENDED]\n    ' + replacement + '\n    return result\n'
            self.assertFalse(server.evaluate('build', source)[0], replacement)
        self.assertTrue(server.evaluate('build', REFERENCE + '\ndef intended_circuit(): return [dict(c) for c in reversed(INTENDED)]\n')[0])

    def test_repair_restores_the_actual_missing_dictionary(self):
        for change in ("added['id']='not-the-missing-id'", "added['out']='granted'"):
            source = REFERENCE + '''
def repair(circuit):
    present=[c['id'] for c in circuit]
    added=next(dict(c) for c in INTENDED if c['id'] not in present)
    ''' + change + '''
    return [dict(c) for c in circuit]+[added]
'''
            for checkpoint in ('repair','mutation-transfer'):
                self.assertFalse(server.evaluate(checkpoint,source)[0], (change,checkpoint))
        # The API accepts a list in any order; the identity of the restored check matters.
        source = REFERENCE + '\n_original_repair=repair\ndef repair(circuit): return list(reversed(_original_repair(circuit)))\n'
        self.assertTrue(server.evaluate('repair',source)[0])

    def test_unfinished_functions_are_not_reported_as_wrapper_errors(self):
        for checkpoint,function,args in (
            ('build','intended_circuit',''),('audit','audit','circuit'),
            ('exploit','forge_witness','circuit, params'),('repair','repair','circuit'),
        ):
            source=REFERENCE+f'\ndef {function}({args}): raise NotImplementedError("hidden marker")\n'
            correct,message=server.evaluate(checkpoint,source)
            self.assertFalse(correct)
            self.assertIn(f'{function} did not return a value',message)
            self.assertNotIn('ValueError',message)
            self.assertNotIn('hidden marker',message)

    def test_unused_looping_function_does_not_block_an_independent_checkpoint(self):
        source = REFERENCE + '\ndef repair(circuit):\n    while True: pass\n'
        with patch.object(execution, 'RUN_TIMEOUT_SECONDS', .5):
            self.assertTrue(server.evaluate('build', source)[0])
            self.assertTrue(server.evaluate('audit', source)[0])
            self.assertTrue(server.evaluate('exploit', source)[0])
            self.assertFalse(server.evaluate('repair', source)[0])
            source = REFERENCE + '\ndef forge_witness(circuit, params):\n    while True: pass\n'
            self.assertTrue(server.evaluate('repair', source)[0])
            self.assertFalse(server.evaluate('mutation-transfer', source)[0])

    def test_supplied_evaluator_import_is_available_to_real_worker(self):
        source = '''from participant.evaluator import residual, satisfies

def intended_circuit():
    c={'kind':'iszero_a','value':'x','inv':'r','out':'z'}
    w={'x':3,'r':5,'z':0}
    return [residual(c,w,7), satisfies([c],w,7)]
'''
        result = execution.run_functions({'policy.py': source}, [{'function':'intended_circuit','args':[]}])
        self.assertEqual(result['values'], [{'returned':[0, True]}])

    def test_unseen_inputs_and_exceptions_are_not_feedback(self):
        source = REFERENCE + '''
def forge_witness(circuit, params):
    print('UNSEEN:'+str(params),flush=True)
    raise ValueError('UNSEEN:'+str(params))
'''
        result = server.evaluate('exploit', source)
        self.assertFalse(result[0])
        self.assertNotIn('UNSEEN:', result[1])
        self.assertNotIn('revoked', result[1])

    def test_false_helper_must_preserve_the_fixed_inputs(self):
        source = REFERENCE + '''
def forge_witness(circuit, params):
    return {'revoked':0,'inv':0,'ok':0,'issuer_ok':1,'granted':0}
'''
        self.assertFalse(server.evaluate('exploit', source)[0])

    def test_private_files_and_network_are_denied_before_source_runs(self):
        source = '''import os, sys, ctypes
libc=ctypes.CDLL(None,use_errno=True)
def intended_circuit():
    allowed=[]
    for p in ['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py','/problem/tests/hidden/check_policy.py']:
        fd=libc.open(p.encode(),0)
        allowed.append(fd>=0)
        if fd>=0: os.close(fd)
    fd=libc.socket(2,1,0)
    allowed.append(fd>=0)
    if fd>=0: os.close(fd)
    return allowed+['FLAG_SEED' in os.environ, any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)]
'''
        result = execution.run_functions({'policy.py': source}, [{'function':'intended_circuit','args':[]}])
        self.assertEqual(result['values'], [{'returned':[False]*7}])

    def test_timeout_is_bounded(self):
        with patch.object(execution, 'RUN_TIMEOUT_SECONDS', .2):
            self.assertIsNone(execution.run_functions({'policy.py':'while True: pass'}, []))

    def test_same_uid_learner_cannot_signal_or_modify_supervisor(self):
        source = '''import os,ctypes
libc=ctypes.CDLL(None,use_errno=True)
def intended_circuit():
    pid=os.getppid()
    signal_denied=libc.kill(pid,0)==-1
    class Limit(ctypes.Structure): _fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    limit_denied=libc.prlimit64(pid,1,ctypes.byref(limit),None)==-1
    return [signal_denied,limit_denied]
'''
        result = execution.run_functions({'policy.py':source}, [{'function':'intended_circuit','args':[]}])
        self.assertEqual(result['values'], [{'returned':[True, True]}])

    def test_success_cleans_forked_children(self):
        source = '''import os
def intended_circuit():
    pid=os.fork()
    if pid==0:
        while True: pass
    return pid
'''
        result = execution.run_functions({'policy.py':source}, [{'function':'intended_circuit','args':[]}])
        pid = result['values'][0]['returned']
        for _ in range(50):
            status = Path(f'/proc/{pid}/stat')
            if not status.exists():
                break
            time.sleep(.02)
        else:
            self.fail('forked learner was not reaped after successful response')




@unittest.skipUnless(sys.platform == 'linux', 'requires the deployed Linux filter')
class FilesystemMetadataBoundary(unittest.TestCase):
    def test_filesystem_metadata_cannot_persist_or_change_parent_fixtures(self):
        import errno
        import subprocess
        import tempfile

        # Load this consumer's actual policy, then apply it in a disposable child.
        # No live Workbench, secret fixtures or host directory is targeted.
        child = r"""
import importlib.util,json,os,sys
spec=importlib.util.spec_from_file_location('policy',sys.argv[1])
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
root=sys.argv[2]
policy.restrict_learner()
calls=[lambda:os.mkdir(root+'/directory'),
       lambda:os.mkdir(root+'/directory-at',dir_fd=-100),
       lambda:os.symlink('original',root+'/symlink'),
       lambda:os.symlink('original',root+'/symlink-at',dir_fd=-100),
       lambda:os.link(root+'/original',root+'/hardlink'),
       lambda:os.link(root+'/original',root+'/hardlink-at',src_dir_fd=-100,dst_dir_fd=-100),
       lambda:os.mkfifo(root+'/fifo'),
       lambda:os.mkfifo(root+'/fifo-at',dir_fd=-100),
       lambda:os.rename(root+'/original',root+'/renamed'),
       lambda:os.rename(root+'/original',root+'/renamed-at',src_dir_fd=-100,dst_dir_fd=-100),
       lambda:os.unlink(root+'/original'),
       lambda:os.unlink(root+'/original',dir_fd=-100),
       lambda:os.rmdir(root+'/empty'),
       lambda:os.rmdir(root+'/empty',dir_fd=-100),
       lambda:os.chmod(root+'/original',0o777),
       lambda:os.chown(root+'/original',os.getuid(),os.getgid()),
       lambda:os.utime(root+'/original',(1,1)),
       lambda:os.setxattr(root+'/original','user.probe',b'created'),
       lambda:os.truncate(root+'/original',0)]
result=[]
for call in calls:
    try:call();result.append(0)
    except OSError as error:result.append(error.errno)
print(json.dumps(result))
"""
        with tempfile.TemporaryDirectory(prefix='learner-fs-boundary-') as folder:
            root=Path(folder)
            original=root/'original'
            original.write_text('owned parent fixture')
            (root/'empty').mkdir()
            before=original.stat()
            attributes={name:os.getxattr(original,name) for name in os.listxattr(original)}
            for attempt in range(16):
                with self.subTest(attempt=attempt):
                    completed=subprocess.run(
                        [sys.executable,'-I','-B','-c',child,str(ROOT/'participant/isolation.py'),folder],
                        capture_output=True,text=True,timeout=5,check=True,
                        env={'PATH':'/usr/local/bin:/usr/bin:/bin'},close_fds=True,
                    )
                    self.assertEqual(json.loads(completed.stdout),[errno.EPERM]*19)
                    self.assertEqual(sorted(p.name for p in root.iterdir()),['empty','original'])
                    self.assertEqual(original.read_text(),'owned parent fixture')
                    after=original.stat()
                    self.assertEqual((after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns),
                                     (before.st_mode,before.st_uid,before.st_gid,before.st_mtime_ns))
                    self.assertEqual({name:os.getxattr(original,name) for name in os.listxattr(original)},attributes)
            # Every subprocess.run has waited for its child; no child can later write.
        self.assertFalse(root.exists(), 'the owned temporary fixture must also be removed')

if __name__ == '__main__':
    unittest.main()
