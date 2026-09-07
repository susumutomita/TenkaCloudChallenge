"""Field object/value boundary regressions in the actual Linux image."""
from __future__ import annotations
import json,os,sys,time,unittest,tempfile
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerError,LearnerSession
from participant.isolation import protect_supervisor
from participant.server import _WORKBENCH
from participant import server as workbench_server
from verifier import server

def reference(): return (ROOT/'reference/field.py').read_text()
def reader(): return (ROOT/'tests/hidden/portal/reader-field.py').read_text()
def zombies():
    found=[]
    for p in Path('/proc').glob('[0-9]*/stat'):
        try:
            if p.read_text().rsplit(')',1)[1].split()[0]=='Z':found.append(p.parent.name)
        except (FileNotFoundError,ProcessLookupError):pass
    return found

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
        body = {'checkpointId': 'normalize', 'submission': 'synthetic-test'}
        verdict = {'checkpointId': 'normalize', 'correct': True}
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
        body = {'checkpointId': 'normalize', 'submission': 'synthetic-test'}
        failed = {'checkpointId': 'normalize', 'correct': False}
        with delayed_verifier(.1, {'checkpointId': 'normalize', 'correct': True}) as url, \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', .02):
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)
        with delayed_verifier(0, {'checkpointId': 'transfer', 'correct': True}) as url:
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)

@unittest.skipUnless(sys.platform=='linux','deployed Linux isolation required')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls): protect_supervisor()

    def test_learner_cannot_change_supervisor_scheduling(self):
        before=(os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0))
        source="import os,ctypes\ndef egcd():\n    libc=ctypes.CDLL(None,use_errno=True)\n    pid=os.getppid()\n    priority=ctypes.c_int(0)\n    calls=[('sched_setscheduler',(pid,5,ctypes.byref(priority))),\n           ('sched_setparam',(pid,ctypes.byref(priority))),\n           ('sched_setaffinity',(pid,0,None)),('setpriority',(0,pid,19))]\n    result=[]\n    for syscall,args in calls:\n        ctypes.set_errno(0)\n        value=getattr(libc,syscall)(*args)\n        result.append(int(value==-1 and ctypes.get_errno()==1))\n    return result\n"
        with LearnerSession({'field.py':source}) as learner:
            self.assertEqual(learner.call('field','egcd',[]),[1,1,1,1])
        self.assertEqual((os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0)),before)

    def test_persistent_ipc_is_denied_and_leaves_no_objects(self):
        paths=[Path('/proc/sysvipc')/name for name in ('shm','msg','sem')]
        before=[path.read_text() for path in paths]
        source='''import ctypes
def egcd():
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
            with LearnerSession({'field.py':source}) as learner:
                self.assertEqual(learner.call('field','egcd',[]),[[-1,1]]*8)
        self.assertEqual([path.read_text() for path in paths],before)

    def test_private_files_parent_environment_network_and_exec_are_denied(self):
        source='''import ctypes,os,sys

def egcd(pids):
    libc=ctypes.CDLL(None,use_errno=True)
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',
           '/problem/tests/hidden/check_field.py']+['/proc/'+p+'/environ' for p in pids]
    readable=False
    for path in paths:
        fd=libc.open(path.encode(),0)
        if fd>=0:readable=True;os.close(fd)
    try:os.execv('/bin/true',['/bin/true']);executed=True
    except OSError:executed=False
    return dict(seed='FLAG_SEED' in os.environ,readable=readable,network=libc.socket(2,1,0)>=0,
                executed=executed,checker=any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules))
'''
        pids=[p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        with LearnerSession({'field.py':source}) as learner:
            self.assertEqual(learner.call('field','egcd',[pids]),dict(seed=False,readable=False,network=False,executed=False,checker=False))

    def test_parent_signal_and_limit_changes_denied_and_fds_closed(self):
        source='''import ctypes,os

def egcd(fd):
    libc=ctypes.CDLL(None,use_errno=True)
    class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    try:os.fstat(fd);inherited=True
    except OSError:inherited=False
    return [libc.kill(os.getppid(),0)==-1,libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1,inherited]
'''
        with open('/dev/null') as handle:
            os.set_inheritable(handle.fileno(),True)
            with LearnerSession({'field.py':source}) as learner:
                self.assertEqual(learner.call('field','egcd',[handle.fileno()]),[True,True,False])

    def test_partial_output_timeout_and_descendant_cleanup(self):
        source='''import os

def egcd():
    pid=os.fork()
    if pid==0:
        while True:pass
    return pid

def egcd_trace():
    os.write(1,b'{"callId":')
    while True:pass
'''
        with LearnerSession({'field.py':source}) as learner:
            pid=learner.call('field','egcd',[])
            # Measure the intentionally incomplete reply after real initialization;
            # image startup scheduling is not the timeout behavior under test.
            start=time.monotonic()
            learner.deadline=start+.3
            with self.assertRaises(LearnerError):learner.call('field','egcd_trace',[])
        self.assertLess(time.monotonic()-start,3)
        for _ in range(100):
            if not Path(f'/proc/{pid}').exists():break
            time.sleep(.01)
        else:self.fail('forked child was not reaped; a zombie is not success')

    def test_repeated_forks_leave_no_zombies(self):
        source=reference()+'\nimport os\nfor _ in range(4):\n    if os.fork()==0:os._exit(0)\n'
        # Wait for all extra processes, not just zombies: a dying live child can
        # become a zombie between two snapshots. No extra PID means it was reaped.
        baseline={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        for attempt in range(64):
            self.assertTrue(server.evaluate('normalize',source),attempt)
            for _ in range(200):
                extra={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}-baseline
                if not extra:break
                time.sleep(.01)
            self.assertEqual(extra,set(),f'unreaped processes after submission {attempt+1}')
            self.assertEqual(zombies(),[],f'submission {attempt+1}')

    def test_deep_startup_json_is_not_a_verdict_and_worker_is_removed(self):
        source='print("["*2000+"0"+"]"*2000,flush=True)\nwhile True:pass\n'
        learner=LearnerSession({'field.py':source},timeout=.2)
        with self.assertRaises(LearnerError):
            with learner:pass
        self.assertIsNotNone(learner.process.returncode)
        self.assertFalse(Path(f'/proc/{learner.process.pid}').exists())

    def test_untrusted_diagnostic_shapes_are_rejected(self):
        learner=LearnerSession({'field.py':reference()})
        for value in ({'file':[],'line':1,'type':'Error'},
                      {'file':'/hidden/secret.py','line':1,'type':'Error'},
                      {'file':'field.py','line':True,'type':'Error'},
                      {'file':'field.py','line':1,'type':'Error\nPASS'},
                      {'file':'field.py','line':100000,'type':'Error'}):
            self.assertEqual(learner._initialization_diagnostic(value),'')

    def test_filesystem_metadata_cannot_persist_or_change_parent_fixtures(self):
        source='''import os
def egcd(root):
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
           lambda:os.setxattr(root+'/original','user.egcd',b'created'),
           lambda:os.truncate(root+'/original',0)]
    result=[]
    for call in calls:
        try:call();result.append(0)
        except OSError as error:result.append(error.errno)
    return result
'''
        with tempfile.TemporaryDirectory(prefix='ot-fs-boundary-') as folder:
            root=Path(folder)
            original=root/'original'
            original.write_text('owned parent fixture')
            (root/'empty').mkdir()
            before=original.stat()
            for _ in range(16):
                with LearnerSession({'field.py':source}) as learner:
                    self.assertEqual(learner.call('field','egcd',[folder]),[1]*19)
                self.assertEqual(sorted(p.name for p in root.iterdir()),['empty','original'])
                self.assertEqual(original.read_text(),'owned parent fixture')
                after=original.stat()
                self.assertEqual((after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns),
                                 (before.st_mode,before.st_uid,before.st_gid,before.st_mtime_ns))
                self.assertEqual(os.listxattr(original),[])

    def test_reader_and_reference_and_all_public_cases(self):
        for source in (reader(),reference()):
            for checkpoint in server.CHECKPOINTS:
                self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
            self.assertTrue(_WORKBENCH.run_public_tests({'field.py':source})['passed'])

    def test_printed_grades_and_static_replies_are_rejected(self):
        for source in ('import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
                       'import os\nprint(\'{"ready":true}\',flush=True)\nprint(\'{"callId":1,"value":0}\',flush=True)\nos._exit(0)'):
            for checkpoint in server.CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(_WORKBENCH.run_public_tests({'field.py':source})['passed'])

    def test_live_id_never_replaces_mathematics(self):
        for alteration in ('value','modulus','bool','float','wrong'):
            source=reader()+r"""
import sys,json,os
_old=FieldElement.__init__
def altered(self,field,value):
    _old(self,field,value)
    f=sys._getframe(1)
    while f and 'call' not in f.f_locals:f=f.f_back
    if f and f.f_locals['call']['function']=='element':
        scope=f.f_locals
        # A protocol-speaking solution can send mathematically valid object data.
        # The object is also retained so following operations can use this handle.
        next_id=scope['next_handle']+1
        scope['objects'][next_id]=self
        record={'id':next_id,'value':self.value,'modulus':field.modulus}
        ALTER
        os.write(1,(json.dumps({'callId':scope['call']['callId'],'value':record})+'\n').encode())
FieldElement.__init__=altered
"""
            change={'value':'pass','modulus':"record['modulus']+=1",'bool':"record['value']=bool(record['value'])",'float':"record['value']=float(record['value'])",'wrong':"record['value']=(record['value']+1)%field.modulus"}[alteration]
            source=source.replace('ALTER',change)
            self.assertEqual(server.evaluate('normalize',source),alteration=='value',alteration)
            self.assertEqual(_WORKBENCH.run_public_tests({'field.py':source})['passed'],alteration=='value',alteration)

    def test_fixed_reply_and_reused_reply_are_ignored(self):
        for good in (True,False):
            source=reader()+r"""
import sys,json,os
_old=egcd
_previous=None
def egcd(*args):
    global _previous
    cid=sys._getframe(1).f_locals['call']['callId']
    value=_old(*args)
    os.write(1,(json.dumps({'callId':_previous or 'fixed','value':value})+'\n').encode())
    _previous=cid
    return value if GOOD else (0,0,0)
"""
            source=source.replace('GOOD',repr(good))
            # egcd is also called inside inverse, so direct egcd-trace isolates this reply test.
            self.assertEqual(server.evaluate('egcd-trace',source),good)

    def test_call_ids_not_in_initial_source_and_are_unique(self):
        source="import sys\ninitial_has_id='callId' in sys._getframe(1).f_locals['initial']\ndef egcd():return [initial_has_id,sys._getframe(1).f_locals['call']['callId']]\n"
        with LearnerSession({'field.py':source}) as learner:
            results=[learner.call('field','egcd',[]) for _ in range(3)]
        self.assertEqual(len({r[1] for r in results}),3)
        for r in results:
            self.assertFalse(r[0]);self.assertRegex(r[1],r'^[0-9a-f]{32}$')

    def test_value_modulus_equality_hash_and_cross_modulus_errors(self):
        variants=[
            ('normalize',"FieldElement.__eq__=lambda self,other:self.value==other.value"),
            ('normalize',"FieldElement.__hash__=lambda self:id(self)"),
            ('normalize',"Field.__init__=lambda self,m:setattr(self,'modulus',m+1)"),
            ('arithmetic',"FieldElement.__mul__=lambda self,other:FieldElement(self.field,1)"),
            ('inverse',"FieldElement.inverse=lambda self:FieldElement(self.field,1)\nFieldElement.__mul__=lambda self,other:FieldElement(self.field,1)"),
            ('errors',"FieldElement.__sub__=lambda self,other:FieldElement(self.field,self.value-other.value)"),
            ('errors',"FieldElement.inverse=lambda self:(_ for _ in ()).throw(ValueError('not the required exception'))"),
            ('composite',"non_invertible_element=lambda m:False"),
        ]
        for checkpoint,patch in variants:
            self.assertFalse(server.evaluate(checkpoint,reader()+'\n'+patch),patch)

    def test_exception_subclasses_and_colliding_hashes_are_valid(self):
        source=reader()+"\nclass DerivedNoInverse(NotInvertible):pass\nclass DerivedMismatch(FieldMismatch):pass\n_inv=FieldElement.inverse\n_add=FieldElement.__add__\ndef inverse(self):\n try:return _inv(self)\n except NotInvertible:raise DerivedNoInverse()\ndef add(self,other):\n try:return _add(self,other)\n except FieldMismatch:raise DerivedMismatch()\nFieldElement.inverse=inverse\nFieldElement.__add__=add\nFieldElement.__hash__=lambda self:0\n"
        for checkpoint in server.CHECKPOINTS:
            self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
        self.assertTrue(_WORKBENCH.run_public_tests({'field.py':source})['passed'])

    def test_builtin_aliases_and_late_exception_rebinding_do_not_pass(self):
        source = reader() + '\nNotInvertible=ValueError\nFieldMismatch=TypeError\n'
        for checkpoint in server.CHECKPOINTS:
            self.assertFalse(server.evaluate(checkpoint, source), checkpoint)
        self.assertFalse(_WORKBENCH.run_public_tests({'field.py': source})['passed'])
        late = reader() + '''
_inverse_before_rebinding = FieldElement.inverse
def inverse(self):
    if self.value == 0:
        globals()['NotInvertible'] = ValueError
    return _inverse_before_rebinding(self)
FieldElement.inverse = inverse
'''
        self.assertFalse(server.evaluate('errors', late))

    def test_exception_metaclass_cannot_claim_builtin_errors(self):
        source = reader().replace('raise NotInvertible(', 'raise ValueError(').replace('raise FieldMismatch(', 'raise TypeError(') + """
class Pretend(type):
    def __instancecheck__(cls, value):
        return True
    def __eq__(cls, other):
        return True
class NotInvertible(Exception, metaclass=Pretend):
    pass
class FieldMismatch(Exception, metaclass=Pretend):
    pass
"""
        self.assertFalse(server.evaluate('errors', source))
        self.assertFalse(_WORKBENCH.run_public_tests({'field.py': source})['passed'])

    def test_field_identity_is_not_mathematical_equality(self):
        source = reader() + "\nFieldElement.__eq__ = lambda self, other: self.field is other.field and self.value == other.value\n"
        self.assertFalse(server.evaluate('normalize', source))
        self.assertFalse(_WORKBENCH.run_public_tests({'field.py': source})['passed'])

    def test_dual_exception_subclass_uses_the_operation_context(self):
        source = reader() + '''
class Both(NotInvertible, FieldMismatch):
    pass
def wrap(operation):
    def call(*args):
        try:
            return operation(*args)
        except (NotInvertible, FieldMismatch):
            raise Both()
    return call
for name in ('inverse', '__add__', '__sub__', '__mul__', '__truediv__'):
    setattr(FieldElement, name, wrap(getattr(FieldElement, name)))
'''
        for checkpoint in server.CHECKPOINTS:
            self.assertTrue(server.evaluate(checkpoint, source), checkpoint)
        self.assertTrue(_WORKBENCH.run_public_tests({'field.py': source})['passed'])
        # Membership is not permission to fail an operation that has an inverse.
        inappropriate = reader() + '''
class Both(NotInvertible, FieldMismatch):
    pass
def inverse(self):
    raise Both()
FieldElement.inverse = inverse
'''
        self.assertFalse(server.evaluate('inverse', inappropriate))

    def test_sequence_representations_and_integer_types(self):
        source=reader()+"\n_old_egcd=egcd\n_old_trace=egcd_trace\ndef egcd(*a):return list(_old_egcd(*a))\ndef egcd_trace(*a):return tuple(_old_trace(*a))\n"
        self.assertTrue(server.evaluate('egcd-trace',source))
        self.assertTrue(_WORKBENCH.run_public_tests({'field.py':source})['passed'])
        for convert in ('float','bool'):
            bad=reader()+f"\n_old_trace=egcd_trace\ndef egcd_trace(*a):return [{{k:{convert}(v) for k,v in row.items()}} for row in _old_trace(*a)]\n"
            self.assertFalse(server.evaluate('egcd-trace',bad))
            self.assertFalse(_WORKBENCH.run_public_tests({'field.py':bad})['passed'])

    def test_public_diagnostics_and_private_generic_feedback(self):
        for source,line,kind in [('def bad(:\n',1,'SyntaxError'),('# first\nimport missing_learner_module\n',2,'ModuleNotFoundError'),('# first\nraise ValueError("SECRET_PATH\\nLEAK")\n',2,'ValueError')]:
            result=_WORKBENCH.run_public_tests({'field.py':source})
            self.assertFalse(result['passed']);self.assertIn(f'field.py:{line}: {kind}',result['output'])
            self.assertNotIn('SECRET_PATH',result['output'])
            correct,message=server.evaluate_with_message('normalize',source)
            self.assertFalse(correct);self.assertNotIn(kind,message);self.assertNotIn('LEAK',message)

    def test_hidden_values_prints_are_not_in_feedback(self):
        source=reader()+"\ndef egcd_trace(a,b):\n print('PRIVATE_OPERAND',a,b)\n raise ValueError('PRIVATE_OPERAND')\n"
        correct,message=server.evaluate_with_message('egcd-trace',source)
        self.assertFalse(correct);self.assertNotIn('PRIVATE_OPERAND',message)

    def test_documented_computational_imports_work(self):
        source=reader()+"\nimport collections,decimal,fractions,functools,hashlib,hmac,itertools,json,math,operator,random,statistics,time,typing\nassert fractions.Fraction(1,2)+fractions.Fraction(1,2)==1\nassert statistics.mean([1,3])==2\nassert random.Random(0).randrange(7) in range(7)\n"
        for checkpoint in server.CHECKPOINTS:
            self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
        self.assertTrue(_WORKBENCH.run_public_tests({'field.py':source})['passed'])

if __name__=='__main__':unittest.main()
