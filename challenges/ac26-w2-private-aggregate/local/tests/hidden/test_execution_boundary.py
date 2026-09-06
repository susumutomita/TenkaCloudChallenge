"""Actual Linux value/observation boundary, with frozen public-only reader evidence."""
from __future__ import annotations
import json
import tempfile
import ctypes,errno,uuid,subprocess,signal,textwrap
import os
import sys
import time
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerError,LearnerSession
from participant.isolation import protect_supervisor
from participant.protocol import Protocol
from participant.server import _WORKBENCH
from participant import server as workbench_server
from tests.public.test_aggregate import run
from fixtures import generate
from verifier import server


def reader():return (ROOT/'tests/hidden/portal/reader-aggregate.py').read_text()


SCHEDULING_HELPER = r'''
"""Disposable parent; only its forked child can target this PID, then both exit."""
import ctypes,json,os,sys
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
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

def opening_source(body, function):
    body=textwrap.dedent(body).replace("def normalize(self,", "def "+function+"(",1)
    return {"aggregate.py":"import ctypes,os,sys\n"+body}

@contextmanager
def delayed_verifier(delay, verdict):
    """A real loopback response, with no learner or external network involved."""
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            time.sleep(delay)
            body = json.dumps(verdict).encode()
            try:
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Expected when exercising the outbound timeout.

        def log_message(self, *_args):
            pass

    http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=http.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{http.server_port}/verify'
    finally:
        http.shutdown()
        http.server_close()
        thread.join()


class VerifierForwarding(unittest.TestCase):
    def test_suite_verdict_outlives_the_client_body_deadline(self):
        body = {'checkpointId': 'plan', 'submission': 'synthetic-test'}
        verdict = {'checkpointId': 'plan', 'correct': True}
        # Scale only this transport test. A real response arrives after the old
        # body-read timeout but before the separate outbound deadline.
        with delayed_verifier(.1, verdict) as url, \
                patch.object(workbench_server, 'REQUEST_TIMEOUT_SECONDS', .02), \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', 1):
            self.assertEqual(workbench_server.proxy_verdict(body, url), verdict)
        self.assertEqual(workbench_server.Handler.timeout, 15)
        self.assertEqual(workbench_server.RUN_TIMEOUT_SECONDS, 25)
        self.assertGreater(workbench_server.VERIFIER_TIMEOUT_SECONDS, server.RUN_TIMEOUT_SECONDS)

    def test_missing_or_mismatched_forwarded_verdict_still_fails_closed(self):
        body = {'checkpointId': 'plan', 'submission': 'synthetic-test'}
        failed = {'checkpointId': 'plan', 'correct': False}
        with delayed_verifier(.1, {'checkpointId': 'plan', 'correct': True}) as url, \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', .02):
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)
        with delayed_verifier(0, {'checkpointId': 'transfer', 'correct': True}) as url:
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)

@unittest.skipUnless(sys.platform=='linux','requires the deployed Linux boundary')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):protect_supervisor()

    def test_documented_computation_helpers_are_available(self):
        source = reader() + "\nimport decimal,fractions,functools,hashlib,hmac,operator,random,statistics,time\nassert fractions.Fraction(2,4)==fractions.Fraction(1,2)\nassert statistics.mean([1,3])==2\nassert random.Random(7).randrange(1)==0\n"
        for checkpoint in server.CHECKPOINTS:
            self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
        self.assertTrue(_WORKBENCH.run_public_tests({'aggregate.py':source})['passed'])

    def test_filesystem_metadata_cannot_persist_or_change_parent_fixtures(self):
        source='''import os
def probe(root):
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
    return result
'''
        with tempfile.TemporaryDirectory(prefix='aggregate-fs-boundary-') as folder:
            root=Path(folder)
            original=root/'original'
            original.write_text('owned parent fixture')
            (root/'empty').mkdir()
            before=original.stat()
            for _ in range(16):
                with LearnerSession({'aggregate.py':source}) as learner:
                    self.assertEqual(learner.call('aggregate','probe',[folder]),[1]*19)
                self.assertEqual(sorted(p.name for p in root.iterdir()),['empty','original'])
                self.assertEqual(original.read_text(),'owned parent fixture')
                after=original.stat()
                self.assertEqual((after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns),
                                 (before.st_mode,before.st_uid,before.st_gid,before.st_mtime_ns))
                self.assertEqual(os.listxattr(original),[])


    def test_frozen_reader_all_checkpoints_public_and_existing_seals(self):
        source=reader()
        import hashlib
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(),'68f80983819ee810e543608dda56cfbc105488a58a1d4de2ce39b41aa6ea79a3')
        prepared=_WORKBENCH.prepare_submissions({'aggregate.py':source},{})
        for cp in server.CHECKPOINTS:
            self.assertTrue(server.evaluate(cp,source),cp)
            sealed=prepared['submissions'][cp]
            self.assertTrue(sealed.startswith('tcw1.'))
            self.assertTrue(server.evaluate(cp,server._unwrap_submission(cp,sealed)))
            other=next(c for c in server.CHECKPOINTS if c!=cp)
            self.assertIsNone(server._unwrap_submission(other,sealed))
            with patch.object(server,'SEED','another-synthetic-run'):
                self.assertIsNone(server._unwrap_submission(cp,sealed))
        with LearnerSession({'aggregate.py':source}) as learner:
            failures,output=run(learner.module(),generate.public_payload('aggregate-reader-boundary'))
            self.assertEqual(failures,[],output)

    def test_plan_can_be_submitted_before_other_functions(self):
        source="def plan(spec):\n return {'multiplications':spec['parties'],'triples':spec['parties'],'rounds':1}\n"
        self.assertTrue(server.evaluate('plan',source))
        self.assertFalse(server.evaluate('multiply',source))

    def test_zero_masks_and_single_owner_are_valid_arithmetic(self):
        st=generate.setting('zero-mask-check')
        with patch.object(generate,'_stream',lambda *args:[0]*160):
            triples=generate.triples('zero-mask-check','zero',st,2)
        self.assertEqual([(sum(t.a)%st.p,sum(t.b)%st.p,sum(t.c)%st.p) for t in triples],[(0,0,0)]*2)
        with LearnerSession({'aggregate.py':reader()}) as learner:
            io=Protocol(7)
            result=learner.module().aggregate([[2]],[[3]],[{'a':[0],'b':[0],'c':[0]}],{'p':7,'parties':1,'bias':1},io)
            self.assertEqual(result,[0])
            self.assertEqual((io.rounds,io.batch_sizes,io.opened),(1,[2],[[2],[3]]))

    def test_public_p7_table_and_measured_duplicate_values(self):
        with LearnerSession({'aggregate.py':reader()}) as learner:
            io=Protocol(7)
            out=learner.module().aggregate([[5,4],[3,5]],[[6,4],[2,2]],
                [{'a':[2,6],'b':[3,6],'c':[4,5]},{'a':[1,2],'b':[4,4],'c':[6,4]}],
                {'p':7,'parties':2,'bias':1},io)
            self.assertEqual(out,[6,5])
            self.assertEqual([sum(s)%7 for s in io.opened],[1,1,5,3])
            self.assertEqual((io.rounds,io.batch_sizes),(1,[4]))

    def test_order_reversal_redistribution_and_other_public_owner_are_accepted(self):
        source=reader().replace('values = io.open_batch(differences)',
            'values = list(reversed(io.open_batch(list(reversed(differences)))))')
        source=source.replace('out[0] = (out[0] + constant) % p','out[-1] = (out[-1] + constant) % p')
        source=source.replace("return add_public(total, spec['bias'], p)",
            "total[0]=(total[0]+1)%p\n    total[-1]=(total[-1]-1)%p\n    return add_public(total, spec['bias'], p)")
        for cp in server.CHECKPOINTS:self.assertTrue(server.evaluate(cp,source),cp)
        self.assertTrue(_WORKBENCH.run_public_tests({'aggregate.py':source})['passed'])

    def test_public_constant_offsets_may_be_distributed_across_owners(self):
        source=reader().replace('out[0] = (out[0] + constant) % p',
            'out[0] = (out[0] + constant + 1) % p\n    out[-1] = (out[-1] - 1) % p')
        for cp in ('linear','multiply','result','transfer'):
            self.assertTrue(server.evaluate(cp,source),cp)

    def test_reuse_and_multiple_batches_keep_their_independent_verdicts(self):
        reused=reader().replace('triple = triple_list[i]','triple = triple_list[0]')
        separate=reader().replace('values = io.open_batch(differences)',
            'values = []\n    for i in range(k):\n        values.extend(io.open_batch(differences[2*i:2*i+2]))')
        for source in (reused,separate):self.assertTrue(server.evaluate('multiply',source))
        self.assertFalse(server.evaluate('privacy',reused))
        self.assertTrue(server.evaluate('cost',reused),'reuse need not reduce opening count')
        self.assertTrue(server.evaluate('privacy',separate))
        self.assertFalse(server.evaluate('cost',separate))

    def test_child_cannot_rewrite_observations_after_opening_inputs(self):
        source=(ROOT/'tests/hidden/forged-observations.py').read_text()
        self.assertTrue(server.evaluate('multiply',source),'arithmetic is separately graded')
        self.assertFalse(server.evaluate('privacy',source))
        self.assertFalse(server.evaluate('cost',source))
        with LearnerSession({'aggregate.py':source}) as learner:
            io=Protocol(7)
            out=learner.module().aggregate([[5,4],[3,5]],[[6,4],[2,2]],
                [{'a':[2,6],'b':[3,6],'c':[4,5]},{'a':[1,2],'b':[4,4],'c':[6,4]}],
                {'p':7,'parties':2,'bias':1},io)
            self.assertEqual(sum(out)%7,4)
            self.assertEqual(io.rounds,2)
            self.assertEqual(io.batch_sizes,[2,4])
            self.assertEqual(io.opened[:2],[[5,4],[3,5]])

    def test_stdout_and_hidden_monkeypatch_do_not_grade(self):
        for source in ['import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
                       'from tests.hidden import check_aggregate\ncheck_aggregate.run=lambda *args:[]']:
            for cp in server.CHECKPOINTS:self.assertFalse(server.evaluate(cp,source),cp)
            self.assertFalse(_WORKBENCH.run_public_tests({'aggregate.py':source})['passed'])

    def test_stale_ready_reply_cannot_supply_a_result(self):
        source='import os\nprint(\'{"ready":true}\',flush=True)\nprint(\'{"callId":1,"value":[0]}\',flush=True)\nos._exit(0)'
        with LearnerSession({'aggregate.py':source}) as learner:
            with self.assertRaises(LearnerError):learner.module().add_public([0],0,7)
        self.assertRegex(learner.sequence,r'^[0-9a-f]{32}$')

    def test_ordered_list_and_tuple_results_and_openings_are_equivalent(self):
        source=reader()+"""
original_share_inputs=share_inputs
original_add_public=add_public
original_aggregate=aggregate
def share_inputs(*args):return tuple(tuple(row) for row in original_share_inputs(*args))
def add_public(*args):return tuple(original_add_public(*args))
def aggregate(*args):return tuple(original_aggregate(*args))
"""
        source=source.replace('values = io.open_batch(differences)',
                              'values = io.open_batch(tuple(tuple(row) for row in differences))')
        for cp in server.CHECKPOINTS:self.assertTrue(server.evaluate(cp,source),cp)
        self.assertTrue(_WORKBENCH.run_public_tests({'aggregate.py':source})['passed'])
        io=Protocol(7)
        self.assertEqual(io.open_batch(((3,5),(3,5),(2,3),(5,5))),[1,1,5,3])
        self.assertEqual((io.rounds,io.batch_sizes),(1,[4]))

    def test_live_reply_values_still_require_parent_mathematics(self):
        for function,cp in [('aggregate','multiply'),('add_public','linear'),('share_inputs','share-inputs')]:
            nested=function=='share_inputs'
            mutations={'correct':'value','wrong length':'value[:-1]',
                       'boolean':'[[True,*value[0][1:]],*value[1:]]' if nested else '[True,*value[1:]]',
                       'float':'[[float(value[0][0]),*value[0][1:]],*value[1:]]' if nested else '[float(value[0]),*value[1:]]',
                       'out of range':'[[value[0][0]+p,*value[0][1:]],*value[1:]]' if nested else '[value[0]+p,*value[1:]]',
                       'wrong sum':'[[(value[0][0]+1)%p,*value[0][1:]],*value[1:]]' if nested else '[(value[0]+1)%p,*value[1:]]'}
            if nested:mutations['wrong inner length']='[value[0][:-1],*value[1:]]'
            for name,expression in mutations.items():
                with self.subTest(function=function,variant=name):
                    source=reader()+f"""
import json,os,sys
original={function}
def {function}(*args):
    value=original(*args)
    p=args[-2]['p'] if {function!r}=='aggregate' else args[-1]
    response={expression}
    call_id=sys._getframe(1).f_locals['call']['callId']
    os.write(1,(json.dumps({{'callId':call_id,'value':response}})+'\\n').encode())
    return tuple(value)
"""
                    self.assertEqual(server.evaluate(cp,source),name=='correct')

    def test_plan_keeps_three_exact_integer_estimates(self):
        for tail in ["{'multiplications':s['parties'],'triples':s['parties'],'rounds':True}",
                     "{'multiplications':s['parties'],'triples':s['parties'],'rounds':1.0}",
                     "{'multiplications':s['parties'],'triples':s['parties'],'rounds':1,'extra':0}"]:
            self.assertFalse(server.evaluate('plan',reader()+'\ndef plan(s):return '+tail+'\n'))

    def test_opening_channel_rejects_noninteger_and_excessive_output(self):
        for value in ('[[True,0]]','[[1.0,0]]','[[-1,0]]','[[spec["p"],0]]'):
            source=reader()+'\ndef aggregate(c,s,t,spec,io):\n io.open_batch('+value+')\n return [0]*spec["parties"]\n'
            self.assertFalse(server.evaluate('cost',source))
        source='def aggregate(c,s,t,spec,io):\n while True:io.open_batch([[0]])\n'
        with LearnerSession({'aggregate.py':source}) as learner:
            io=Protocol(7)
            with self.assertRaisesRegex(LearnerError,'Opening output exceeded'):
                learner.module().aggregate([],[],[],{'p':7,'parties':1,'bias':0},io)
            self.assertLess(len(io.opened),1024)

    def test_duplicate_opening_request_id_fails_closed(self):
        source='''import sys,json
print('{"ready":true}',flush=True)
call=json.loads(sys.stdin.readline())
request={'callId':call['callId'],'openingId':0,'opening':[[0]]}
print(json.dumps(request),flush=True)
sys.stdin.readline()
print(json.dumps(request),flush=True)
while True:pass
'''
        with LearnerSession({'aggregate.py':source}) as learner:
            io=Protocol(7)
            with self.assertRaisesRegex(LearnerError,'malformed'):
                learner.module().aggregate([],[],[],{'p':7,'parties':1,'bias':0},io)
            self.assertEqual(io.rounds,1)

    def test_timeout_kills_and_reaps_descendants_then_recovers(self):
        source='''import os
def add_public():
 pid=os.fork()
 if pid==0:
  while True:pass
 return [pid]
def share_inputs():
 os.write(1,b'{"callId":')
 while True:pass
'''
        with LearnerSession({'aggregate.py':source},timeout=5) as learner:
            pid=learner.call('aggregate','add_public',[])[0]
            start=time.monotonic();learner.deadline=start+.3
            with self.assertRaises(LearnerError):learner.call('aggregate','share_inputs',[])
        self.assertLess(time.monotonic()-start,3)
        for _ in range(300):
            if not Path(f'/proc/{pid}').exists():break
            time.sleep(.01)
        else:self.fail('unreaped descendant')
        self.assertTrue(server.evaluate('plan',reader()))

    def test_repeated_forks_leave_no_live_or_zombie_descendants(self):
        source=reader()+'\nimport os\nfor _ in range(4):\n if os.fork()==0:os._exit(0)\n'
        baseline={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        for attempt in range(32):
            self.assertTrue(server.evaluate('plan',source),attempt)
            for _ in range(300):
                extra={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}-baseline
                if not extra:break
                time.sleep(.01)
            self.assertEqual(extra,set())

    def test_diagnostics_use_source_locations_and_never_hidden_input_text(self):
        for source,line,kind in [('def bad(:\n',1,'SyntaxError'),('# one\nraise ValueError("DO_NOT_EXPOSE")',2,'ValueError')]:
            self.assertEqual(_WORKBENCH.run_public_tests({'aggregate.py':source}),{'passed':False,'output':f'aggregate.py:{line}: {kind}'})
            correct,message=server.evaluate_with_message('plan',source)
            self.assertFalse(correct);self.assertNotIn('DO_NOT_EXPOSE',message)
        correct,message=server.evaluate_with_message('plan','def plan(s):\n print("HIDDEN:"+str(s),flush=True)\n raise ValueError(str(s))')
        self.assertFalse(correct);self.assertNotIn('HIDDEN',message)


    def test_persistent_ipc_syscalls_are_denied_without_residual_objects(self):
        paths=[Path('/proc/sysvipc')/name for name in ('shm','msg','sem')]
        before=[path.read_text() for path in paths]
        source="""import ctypes
        """+'\ndef add_public():\n    libc=ctypes.CDLL(None,use_errno=True)\n    calls=[("shmget",(0,4096,0o1600)),("shmat",(-1,None,0)),("shmdt",(None,)),("shmctl",(-1,0,None)),("msgget",(0,0o1600)),("msgsnd",(-1,None,0,0)),("msgrcv",(-1,None,0,0,0)),("msgctl",(-1,0,None)),("semget",(0,1,0o1600)),("semop",(-1,None,0)),("semtimedop",(-1,None,0,None)),("semctl",(-1,0,0))]\n    out=[]\n    for name,args in calls:\n        ctypes.set_errno(0)\n        result=getattr(libc,name)(*args)\n        out.append(int(result==-1 and ctypes.get_errno()==1))\n    return out\n'
        for _ in range(16):
            with LearnerSession({'aggregate.py':source}) as learner:
                self.assertEqual(learner.call('aggregate','add_public',[]),[1]*12)
        self.assertEqual([path.read_text() for path in paths],before)

    def test_all_process_environment_private_files_network_exec_are_denied(self):
        source="""import ctypes,os,sys
def add_public(pids):
    libc=ctypes.CDLL(None,use_errno=True)
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py','/problem/tests/hidden/check_aggregate.py']+['/proc/'+p+'/environ' for p in pids]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0:readable=True;os.close(fd)
    try:os.execv('/bin/true',['/bin/true']);executed=True
    except OSError:executed=False
    return [int('FLAG_SEED' in os.environ),int(readable),int(libc.socket(2,1,0)>=0),int(executed),int(any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules))]
"""
        pids=[p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        with LearnerSession({'aggregate.py':source}) as learner:
            self.assertEqual(learner.call('aggregate','add_public',[pids]),[0]*5)

    def test_parent_signals_resource_limits_and_inherited_fds(self):
        source="""import ctypes,os
def add_public(fd):
    libc=ctypes.CDLL(None,use_errno=True)
    class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    try:os.fstat(fd);inherited=True
    except OSError:inherited=False
    return [int(libc.kill(os.getppid(),0)==-1),int(libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1),int(inherited)]
"""
        with open('/dev/null') as handle:
            os.set_inheritable(handle.fileno(),True)
            with LearnerSession({'aggregate.py':source}) as learner:
                self.assertEqual(learner.call('aggregate','add_public',[handle.fileno()]),[1,1,0])


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
        source = opening_source('''    def normalize(self, arguments):
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
''', 'share_inputs')
        for attempt in range(64):
            name = '/aggregate-ipc-' + uuid.uuid4().hex
            results = []
            try:
                with LearnerSession(source) as learner:
                    results = learner.call('aggregate', 'share_inputs', [[name, mq_unlink_number]], 97)
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
        source = opening_source('''    def normalize(self, names):
        lib = ctypes.CDLL(None, use_errno=True)
        lib.sem_open.restype = ctypes.c_void_p
        errors = []
        for fn,args in [('shm_open',(names[0].encode(),os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600)),
                        ('sem_open',(names[1].encode(),os.O_CREAT|os.O_EXCL,0o600,1))]:
            ctypes.set_errno(0)
            getattr(lib,fn)(*args)
            errors.append(ctypes.get_errno())
        return errors
''', 'add_public')
        for attempt in range(64):
            names = ['/aggregate-shm-' + uuid.uuid4().hex, '/aggregate-sem-' + uuid.uuid4().hex]
            try:
                with LearnerSession(source) as learner:
                    self.assertEqual(learner.call('aggregate','add_public',[names],97), [errno.EPERM]*2)
                self.assertEqual({path.name for path in Path('/dev/shm').iterdir()}, before)
            finally:
                for fn,name in zip(('shm_unlink','sem_unlink'),names):
                    ctypes.set_errno(0)
                    removed = getattr(libc,fn)(name.encode())
                    self.assertTrue(removed == 0 or ctypes.get_errno() == errno.ENOENT)
        self.assertEqual({path.name for path in Path('/dev/shm').iterdir()}, before)

if __name__=="__main__":unittest.main()
