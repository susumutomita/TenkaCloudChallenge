"""Real Linux OT value-boundary regressions with synthetic inputs only."""
from __future__ import annotations
import json,os,sys,time,unittest,tempfile
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerError,LearnerSession
from participant.isolation import protect_supervisor
from participant.server import _WORKBENCH
from participant import server as workbench_server
from tests.public.test_oblivious import run_cases
from tests.hidden import check_oblivious
from fixtures.generate import public_payload
from verifier import server

def reference():return (ROOT/'reference/oblivious.py').read_text()
def reader():return (ROOT/'tests/hidden/portal/reader-oblivious.py').read_text()
def zombies():
    found=[]
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            if path.read_text().rsplit(')',1)[1].split()[0]=='Z':found.append(path.parent.name)
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
        body = {'checkpointId': 'request', 'submission': 'synthetic-test'}
        verdict = {'checkpointId': 'request', 'correct': True}
        # Scale only this transport test. A real response arrives after the old
        # body-read timeout but before the separate outbound deadline.
        with delayed_verifier(.1, verdict) as url, \
                patch.object(workbench_server, 'REQUEST_TIMEOUT_SECONDS', .02), \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', 1):
            self.assertEqual(workbench_server.proxy_verdict(body, url), verdict)
        self.assertEqual(workbench_server.Handler.timeout, 15)
        self.assertEqual(workbench_server.RUN_TIMEOUT_SECONDS, 20)
        self.assertGreater(workbench_server.VERIFIER_TIMEOUT_SECONDS, server.RUN_TIMEOUT_SECONDS)

    def test_missing_or_mismatched_forwarded_verdict_still_fails_closed(self):
        body = {'checkpointId': 'request', 'submission': 'synthetic-test'}
        failed = {'checkpointId': 'request', 'correct': False}
        with delayed_verifier(.1, {'checkpointId': 'request', 'correct': True}) as url, \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', .02):
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)
        with delayed_verifier(0, {'checkpointId': 'transfer', 'correct': True}) as url:
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)

@unittest.skipUnless(sys.platform=='linux','requires deployed Linux isolation')
class ExecutionBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_documented_computation_helpers_can_be_imported(self):
        source = reference() + "\nimport decimal, fractions, functools, hashlib, hmac, operator, random, statistics, time\nassert fractions.Fraction(2, 4) == fractions.Fraction(1, 2)\nassert statistics.mean([1, 3]) == 2\nassert random.Random(7).randrange(1) == 0\n"
        for checkpoint in server.CODE_CHECKPOINTS:
            self.assertTrue(server.evaluate(checkpoint, source), checkpoint)
        self.assertTrue(_WORKBENCH.run_public_tests({'oblivious.py': source})['passed'])

    def test_valid_computation_keeps_the_twenty_second_cpu_allowance(self):
        source = reference() + "\nimport time\nstarted = time.process_time()\nwhile time.process_time() - started < 5.25: sum(range(1000))\n"
        self.assertTrue(server.evaluate('request', source))

    def test_learner_cannot_change_supervisor_scheduling(self):
        before=(os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0))
        source="import os,ctypes\ndef probe():\n    libc=ctypes.CDLL(None,use_errno=True)\n    pid=os.getppid()\n    priority=ctypes.c_int(0)\n    calls=[('sched_setscheduler',(pid,5,ctypes.byref(priority))),\n           ('sched_setparam',(pid,ctypes.byref(priority))),\n           ('sched_setaffinity',(pid,0,None)),('setpriority',(0,pid,19))]\n    result=[]\n    for syscall,args in calls:\n        ctypes.set_errno(0)\n        value=getattr(libc,syscall)(*args)\n        result.append(int(value==-1 and ctypes.get_errno()==1))\n    return result\n"
        with LearnerSession({'oblivious.py':source}) as learner:
            self.assertEqual(learner.call('oblivious','probe',[]),[1,1,1,1])
        self.assertEqual((os.sched_getscheduler(0),os.getpriority(os.PRIO_PROCESS,0),os.sched_getaffinity(0)),before)

    def test_persistent_ipc_is_denied_and_leaves_no_objects(self):
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
            with LearnerSession({'oblivious.py':source}) as learner:
                self.assertEqual(learner.call('oblivious','probe',[]),[[-1,1]]*8)
        self.assertEqual([path.read_text() for path in paths],before)

    def test_private_files_parent_environment_network_and_exec_are_denied(self):
        source='''import ctypes,os,sys

def probe(pids):
    libc=ctypes.CDLL(None,use_errno=True)
    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',
           '/problem/tests/hidden/check_oblivious.py']+['/proc/'+p+'/environ' for p in pids]
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
        with LearnerSession({'oblivious.py':source}) as learner:
            self.assertEqual(learner.call('oblivious','probe',[pids]),dict(seed=False,readable=False,network=False,executed=False,checker=False))

    def test_parent_signal_and_limit_changes_denied_and_fds_closed(self):
        source='''import ctypes,os

def probe(fd):
    libc=ctypes.CDLL(None,use_errno=True)
    class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]
    limit=Limit(0,0)
    try:os.fstat(fd);inherited=True
    except OSError:inherited=False
    return [libc.kill(os.getppid(),0)==-1,libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1,inherited]
'''
        with open('/dev/null') as handle:
            os.set_inheritable(handle.fileno(),True)
            with LearnerSession({'oblivious.py':source}) as learner:
                self.assertEqual(learner.call('oblivious','probe',[handle.fileno()]),[True,True,False])

    def test_partial_output_timeout_and_descendant_cleanup(self):
        source='''import os

def probe():
    pid=os.fork()
    if pid==0:
        while True:pass
    return pid

def hang():
    os.write(1,b'{"callId":')
    while True:pass
'''
        with LearnerSession({'oblivious.py':source}) as learner:
            pid=learner.call('oblivious','probe',[])
            # Measure the intentionally incomplete reply after real initialization;
            # image startup scheduling is not the timeout behavior under test.
            start=time.monotonic()
            learner.deadline=start+.3
            with self.assertRaises(LearnerError):learner.call('oblivious','hang',[])
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
            self.assertTrue(server.evaluate('request',source),attempt)
            for _ in range(200):
                extra={p.name for p in Path('/proc').iterdir() if p.name.isdigit()}-baseline
                if not extra:break
                time.sleep(.01)
            self.assertEqual(extra,set(),f'unreaped processes after submission {attempt+1}')
            self.assertEqual(zombies(),[],f'submission {attempt+1}')

    def test_public_diagnostics_are_source_locations_only_private_is_generic(self):
        for source,line,kind in (('def bad(:\n',1,'SyntaxError'),
                                 ('# line one\nimport missing_learner_module\n',2,'ModuleNotFoundError'),
                                 ('# line one\nraise ValueError("private-path\\nBAD_TEXT")\n',2,'ValueError')):
            result=_WORKBENCH.run_public_tests({'oblivious.py':source})
            self.assertEqual(result,{'passed':False,'output':f'oblivious.py:{line}: {kind}'})
            correct,message=server.evaluate_with_message('request',source)
            self.assertFalse(correct)
            self.assertNotIn(kind,message)
            self.assertNotIn('BAD_TEXT',message)

    def test_deep_startup_json_is_not_a_verdict_and_worker_is_removed(self):
        source='print("["*2000+"0"+"]"*2000,flush=True)\nwhile True:pass\n'
        learner=LearnerSession({'oblivious.py':source},timeout=.2)
        with self.assertRaises(LearnerError):
            with learner:pass
        self.assertIsNotNone(learner.process.returncode)
        self.assertFalse(Path(f'/proc/{learner.process.pid}').exists())

    def test_untrusted_diagnostic_shapes_are_rejected(self):
        learner=LearnerSession({'oblivious.py':reference()})
        for value in ({'file':[],'line':1,'type':'Error'},
                      {'file':'/hidden/secret.py','line':1,'type':'Error'},
                      {'file':'oblivious.py','line':True,'type':'Error'},
                      {'file':'oblivious.py','line':1,'type':'Error\nPASS'},
                      {'file':'oblivious.py','line':100000,'type':'Error'}):
            self.assertEqual(learner._initialization_diagnostic(value),'')

    def test_frozen_reader_and_reference_pass_all_checkpoints(self):
        for source in (reader(),reference()):
            for checkpoint in server.CHECKPOINTS:
                self.assertTrue(server.evaluate(checkpoint,source),checkpoint)
            self.assertTrue(_WORKBENCH.run_public_tests({'oblivious.py':source})['passed'])

    def test_success_text_and_preprinted_replies_are_not_grades(self):
        for source in ('import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
                       'import os\nprint(\'{"ready":true}\',flush=True)\nprint(\'{"callId":1,"value":1}\',flush=True)\nos._exit(0)'):
            for checkpoint in server.CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(_WORKBENCH.run_public_tests({'oblivious.py':source})['passed'])

    def test_live_values_are_untrusted_and_ids_are_fresh(self):
        source="""import sys
initial_has_id='callId' in sys._getframe(1).f_locals['initial']
def probe():return [initial_has_id,sys._getframe(1).f_locals['call']['callId']]
"""
        with LearnerSession({'oblivious.py':source}) as learner:
            results=[learner.call('oblivious','probe',[]) for _ in range(3)]
        self.assertTrue(all(not r[0] for r in results))
        self.assertEqual(len({r[1] for r in results}),3)
        for r in results:self.assertRegex(r[1],r'^[0-9a-f]{32}$')
        for correct in (True,False):
            source=reader()+f"""
import sys,json,os
_original=request
def request(*args):
    value=_original(*args)
    response=value if {correct} else 0
    call_id=sys._getframe(1).f_locals['call']['callId']
    os.write(1,(json.dumps({{'callId':call_id,'value':response}})+'\\n').encode())
    return value
"""
            self.assertEqual(server.evaluate('request',source),correct)
            self.assertEqual(_WORKBENCH.run_public_tests({'oblivious.py':source})['passed'],correct)

    def test_full_shifted_cycle_is_valid_and_missing_residue_is_not(self):
        shifted=reader()+"\ndef blind_range(grp):return (grp['q'],2*grp['q']-1)\n"
        self.assertTrue(server.evaluate('choice-privacy',shifted))
        self.assertTrue(server.evaluate('unseen',shifted))
        missing=reader()+"\ndef blind_range(grp):return (1,grp['q']-1)\n"
        self.assertFalse(server.evaluate('choice-privacy',missing))
        self.assertTrue(server.evaluate('transfer',missing))

    def test_counts_reject_same_support_with_biased_output(self):
        source=(ROOT/'tests/hidden/biased_gate.py').read_text()
        self.assertTrue(server.evaluate('and-gate',source),'keep all64 correct reconstructions')
        self.assertFalse(server.evaluate('gate-privacy',source),'support equality alone is insufficient')

    def test_reused_mask_stays_correct_but_fails_privacy(self):
        source=reader()+"\ndef gate_masks(r):return (r[0],r[0])\n"
        self.assertTrue(server.evaluate('and-gate',source))
        self.assertFalse(server.evaluate('gate-privacy',source))

    def test_pairs_and_scalar_types_survive_json_without_coercion(self):
        source=reader()+"\n_original=encrypt\ndef encrypt(*args):return list(_original(*args))\n"
        self.assertTrue(server.evaluate('transfer',source))
        self.assertTrue(_WORKBENCH.run_public_tests({'oblivious.py':source})['passed'])
        for suffix,checkpoint in (("\n_original=unwrap\ndef unwrap(*a):return float(_original(*a))\n",'transfer'),
                                   ("\ndef offer(u,m):return (False,True)\n",'and-gate'),
                                   ("\ndef needs_transfer(g):return int(g=='and')\n",'and-gate')):
            self.assertFalse(server.evaluate(checkpoint,reader()+suffix))
            self.assertFalse(_WORKBENCH.run_public_tests({'oblivious.py':reader()+suffix})['passed'])

    def test_public_helper_is_available_without_seed_or_checker(self):
        source="""from participant.ot import derive_key
import os,sys
def probe():return [type(derive_key({'p':7},4)) is int,'FLAG_SEED' in os.environ,any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules)]
"""
        with LearnerSession({'oblivious.py':source}) as learner:
            self.assertEqual(learner.call('oblivious','probe',[]),[True,False,False])

    def test_hidden_input_never_reaches_feedback(self):
        source="""def request(grp,public,choice,blind):
    print('HIDDEN_INPUT:'+str(grp),flush=True)
    raise ValueError('HIDDEN_INPUT:'+str(grp))
"""
        correct,message=server.evaluate_with_message('request',source)
        self.assertFalse(correct);self.assertNotIn('HIDDEN_INPUT',message)

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
        with tempfile.TemporaryDirectory(prefix='ot-fs-boundary-') as folder:
            root=Path(folder)
            original=root/'original'
            original.write_text('owned parent fixture')
            (root/'empty').mkdir()
            before=original.stat()
            for _ in range(16):
                with LearnerSession({'oblivious.py':source}) as learner:
                    self.assertEqual(learner.call('oblivious','probe',[folder]),[1]*19)
                self.assertEqual(sorted(p.name for p in root.iterdir()),['empty','original'])
                self.assertEqual(original.read_text(),'owned parent fixture')
                after=original.stat()
                self.assertEqual((after.st_mode,after.st_uid,after.st_gid,after.st_mtime_ns),
                                 (before.st_mode,before.st_uid,before.st_gid,before.st_mtime_ns))
                self.assertEqual(os.listxattr(original),[])

if __name__=='__main__':unittest.main()
