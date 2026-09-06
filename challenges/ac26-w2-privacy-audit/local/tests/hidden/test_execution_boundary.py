"""Real Linux boundary and audit regressions; only synthetic inputs and seeds."""
from __future__ import annotations
import ctypes
import json
import os
import sys
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from participant.execution import LearnerError,LearnerSession
from participant.isolation import protect_supervisor
from participant.server import _WORKBENCH
from tests.public.test_auditor import run_cases
from tests.hidden import check_auditor
from fixtures.generate import public_payload, spec, program, execute, expected_total, PROGRAM_IDS, TRUTH
from verifier import server

def reference():return (ROOT/'reference/auditor.py').read_text()
def zombies():
    found=[]
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            if path.read_text().rsplit(')',1)[1].split()[0]=='Z':found.append(path.parent.name)
        except (FileNotFoundError,ProcessLookupError):pass
    return found

@unittest.skipUnless(sys.platform == 'linux', 'requires deployed Linux isolation')
class ExecutionBoundary(unittest.TestCase):

    def test_static_startup_frames_and_old_grade_payload_do_not_pass(self):
        for source in (
            'import os\nprint(\'{"failures":[]}\',flush=True)\nos._exit(0)',
            'import os\nprint(\'{"ready":true}\',flush=True)\nprint(\'{"callId":1,"value":[]}\',flush=True)\nos._exit(0)',
            'import os\nprint(\'{"ready":true}\',flush=True)\nprint(\'{"callId":"00000000000000000000000000000000","value":[]}\',flush=True)\nos._exit(0)',
            'from tests.hidden import check_auditor\ncheck_auditor.run=lambda *args:[]'):
            for checkpoint in server.CODE_CHECKPOINTS:
                self.assertFalse(server.evaluate(checkpoint,source),checkpoint)
            self.assertFalse(_WORKBENCH.run_public_tests({'auditor.py':source})['passed'])

    def test_fresh_ids_and_reused_id_or_eof_rejected(self):
        source='''import sys
initial_had_calls='callId' in sys._getframe(1).f_locals['initial']
def probe():return [initial_had_calls,sys._getframe(1).f_locals['call']['callId']]
'''
        with LearnerSession({'auditor.py':source}) as learner:
            rows=[learner.call('auditor','probe',[]) for _ in range(3)]
        self.assertEqual(len({row[1] for row in rows}),3)
        self.assertTrue(all(row[0] is False for row in rows))
        for row in rows:self.assertRegex(row[1],r'^[0-9a-f]{32}$')
        source='''import json,os,sys
previous=None
def probe():
    global previous
    call=sys._getframe(1).f_locals['call']
    if previous:
        print(json.dumps({'callId':previous,'value':7}),flush=True)
        os._exit(0)
    previous=call['callId']
    return 7
'''
        with LearnerSession({'auditor.py':source}) as learner:
            self.assertEqual(learner.call('auditor','probe',[]),7)
            with self.assertRaises(LearnerError):learner.call('auditor','probe',[])

    def test_return_shapes_and_math_remain_parent_checked(self):
        variants=[
            ('allowed-opens','original=allowed_opens\ndef allowed_opens(spec):return list(reversed(original(spec)))'),
            ('allowed-opens','original=allowed_opens\ndef allowed_opens(spec):return tuple(original(spec))'),
            ('mutation','original=first_violation\ndef first_violation(trace,spec):\n value=original(trace,spec)\n if value:value["index"]=0\n return value'),
            ('repair','original=repair\ndef repair(program,spec):return original(program,spec)+[("const","unused",0)]'),
            ('repair','original=repair\ndef repair(program,spec):return tuple(original(program,spec))'),
            ('repair','original=repair\ndef repair(program,spec):return [(op[0],op[1],float(op[2])) if op[0]=="const" else op for op in original(program,spec)]'),
            ('transcript','def derive_secret(*args):return {"party":"p0","value":True}'),
        ]
        for checkpoint,override in variants:
            self.assertFalse(server.evaluate(checkpoint,reference()+'\n'+override+'\n'),checkpoint)
        # JSON arrays carrying unchanged operation tuples remain valid.
        source=reference()+'\noriginal=repair\ndef repair(program,spec):return [list(op) for op in original(program,spec)]\n'
        self.assertTrue(server.evaluate('repair',source))

    def test_name_heuristics_fail_after_actual_opaque_renaming(self):
        source=reference()+'''
def first_violation(trace,spec):
    for index,event in enumerate(trace):
        kind=event['kind'];name=event['label'];reason=None
        if kind=='open' and name.endswith('sub'):reason='opened-a-secret'
        if kind=='peek' and event['party']!=event['owner']:reason='cross-party-read'
        if kind=='emit' and 'x-' in name:reason='leaked-in-log'
        if kind=='fail' and 'x-' in name:reason='leaked-in-error'
        if reason:return {'kind':reason,'index':index}
    return None
'''
        self.assertFalse(server.evaluate('mutation',source))
        self.assertTrue(server.evaluate('mutation',reference()))

    def test_generated_program_claims_and_zero_masks(self):
        for seed in ('claim-a','claim-b','claim-c'):
            for sp in (spec(seed),replace(spec(seed),masks={p:0 for p in spec(seed).parties})):
                count=0
                for program_id in PROGRAM_IDS:
                    run=execute(program(sp,program_id),sp)
                    self.assertEqual(run.output,expected_total(sp))
                    self.assertTrue(all(set(e)=={'kind','label','party','owner','text','value'} for e in run.events))
                    leak=check_auditor._leaks(run,sp)
                    self.assertEqual(leak,TRUTH[program_id] is not None)
                    count+=leak
                self.assertEqual(len(PROGRAM_IDS),7)
                self.assertEqual(count,4)
        from fixtures import generate
        original=generate._pick
        with patch.object(generate,'_pick',wraps=original) as pick:
            sp=generate.spec('bounds')
            mask_calls=[call.args for call in pick.call_args_list if call.args[1] in (40,42,44)]
            self.assertEqual(len(mask_calls),3)
            self.assertTrue(all(args[2:]==(0,sp.p-1) for args in mask_calls))

    def test_scheduler_mutations_denied_parent_unchanged(self):
        pid=os.getpid()
        before=(os.getpriority(os.PRIO_PROCESS,pid),os.sched_getscheduler(pid),os.sched_getaffinity(pid))
        source='''import ctypes,os
def probe(pid):
    libc=ctypes.CDLL(None,use_errno=True)
    class Param(ctypes.Structure):_fields_=[('priority',ctypes.c_int)]
    param=Param(0)
    mask=ctypes.c_ulong(1)
    result=[]
    for name,args in [('sched_setscheduler',(pid,5,ctypes.byref(param))),
                      ('sched_setparam',(pid,ctypes.byref(param))),
                      ('sched_setaffinity',(pid,ctypes.sizeof(mask),ctypes.byref(mask))),
                      ('setpriority',(0,pid,19))]:
        ctypes.set_errno(0)
        result.append([getattr(libc,name)(*args),ctypes.get_errno()])
    # The two Linux-specific APIs have no portable libc wrapper. Resolve the
    # native ABI numbers via the already-loaded seccomp library.
    library=sys.modules['isolation'].ctypes.CDLL('libseccomp.so.2')
    library.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p]
    for name,args in [(b'sched_setattr',(pid,None,0)),(b'ioprio_set',(1,pid,0))]:
        ctypes.set_errno(0)
        result.append([libc.syscall(library.seccomp_syscall_resolve_name(name),*args),ctypes.get_errno()])
    return result
import sys
'''
        with LearnerSession({'auditor.py':source}) as learner:
            self.assertEqual(learner.call('auditor','probe',[pid]),[[-1,1]]*6)
        self.assertEqual((os.getpriority(os.PRIO_PROCESS,pid),os.sched_getscheduler(pid),os.sched_getaffinity(pid)),before)

    def test_independent_checkpoint_and_private_feedback(self):
        source=reference()+'\ndef repair(*args):\n while True:pass\n'
        self.assertTrue(server.evaluate('allowed-opens',source))
        source='def first_violation(a,b):\n print("HIDDEN_INPUT:"+str(a),flush=True)\n raise ValueError("HIDDEN_INPUT:"+str(a))\n'
        correct,message=server.evaluate_with_message('opened-secret',source)
        self.assertFalse(correct)
        self.assertNotIn('HIDDEN_INPUT',message)

    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def test_reference_and_public_examples(self):
        for seed in ('boundary-one', 'boundary-two'):
            with patch.object(server, 'SEED', seed):
                for checkpoint in server.CODE_CHECKPOINTS:
                    self.assertTrue(server.evaluate(checkpoint, reference()), checkpoint)
            with LearnerSession({'auditor.py': reference()}) as learner:
                passed, output = run_cases(learner.module(), public_payload(seed))
                self.assertTrue(passed, output)

    def test_persistent_ipc_is_denied_and_leaves_no_objects(self):
        paths = [Path('/proc/sysvipc') / name for name in ('shm', 'msg', 'sem')]
        before = [path.read_text() for path in paths]
        source = "import ctypes\ndef probe():\n    libc=ctypes.CDLL(None,use_errno=True)\n    calls=[('shmget',(0,4096,0o1600)),('shmat',(-1,None,0)),\n           ('shmctl',(-1,0,None)),('msgget',(0,0o1600)),('msgctl',(-1,0,None)),\n           ('semget',(0,1,0o1600)),('semctl',(-1,0,0)),('semop',(-1,None,0))]\n    results=[]\n    for name,args in calls:\n        ctypes.set_errno(0)\n        result=getattr(libc,name)(*args)\n        results.append([result,ctypes.get_errno()])\n    return results\n"
        for _ in range(16):
            with LearnerSession({'auditor.py': source}) as learner:
                self.assertEqual(learner.call('auditor', 'probe', []), [[-1, 1]] * 8)
        self.assertEqual([path.read_text() for path in paths], before)

    def test_private_files_parent_environment_network_and_exec_are_denied(self):
        source = "import ctypes,os,sys\n\ndef probe(pids):\n    libc=ctypes.CDLL(None,use_errno=True)\n    paths=['/proc/self/environ','/proc/1/environ','/problem/fixtures/generate.py',\n           '/problem/tests/hidden/check_auditor.py']+['/proc/'+p+'/environ' for p in pids]\n    readable=False\n    for path in paths:\n        fd=libc.open(path.encode(),0)\n        if fd>=0:readable=True;os.close(fd)\n    try:os.execv('/bin/true',['/bin/true']);executed=True\n    except OSError:executed=False\n    return dict(seed='FLAG_SEED' in os.environ,readable=readable,network=libc.socket(2,1,0)>=0,\n                executed=executed,checker=any(n.startswith(('fixtures','tests.hidden','verifier')) for n in sys.modules))\n"
        pids = [p.name for p in Path('/proc').iterdir() if p.name.isdigit()]
        with LearnerSession({'auditor.py': source}) as learner:
            self.assertEqual(learner.call('auditor', 'probe', [pids]), dict(seed=False, readable=False, network=False, executed=False, checker=False))

    def test_parent_signal_and_limit_changes_denied_and_fds_closed(self):
        source = "import ctypes,os\n\ndef probe(fd):\n    libc=ctypes.CDLL(None,use_errno=True)\n    class Limit(ctypes.Structure):_fields_=[('cur',ctypes.c_ulonglong),('max',ctypes.c_ulonglong)]\n    limit=Limit(0,0)\n    try:os.fstat(fd);inherited=True\n    except OSError:inherited=False\n    return [libc.kill(os.getppid(),0)==-1,libc.prlimit64(os.getppid(),1,ctypes.byref(limit),None)==-1,inherited]\n"
        with open('/dev/null') as handle:
            os.set_inheritable(handle.fileno(), True)
            with LearnerSession({'auditor.py': source}) as learner:
                self.assertEqual(learner.call('auditor', 'probe', [handle.fileno()]), [True, True, False])

    def test_partial_output_timeout_and_descendant_cleanup(self):
        source = 'import os\n\ndef probe():\n    pid=os.fork()\n    if pid==0:\n        while True:pass\n    return pid\n\ndef hang():\n    os.write(1,b\'{"callId":\')\n    while True:pass\n'
        start = time.monotonic()
        with LearnerSession({'auditor.py': source}, timeout=0.3) as learner:
            pid = learner.call('auditor', 'probe', [])
            with self.assertRaises(LearnerError):
                learner.call('auditor', 'hang', [])
        self.assertLess(time.monotonic() - start, 3)
        for _ in range(100):
            if not Path(f'/proc/{pid}').exists():
                break
            time.sleep(0.01)
        else:
            self.fail('forked child was not reaped; a zombie is not success')

    def test_repeated_forks_leave_no_zombies(self):
        source = reference() + '\nimport os\nfor _ in range(4):\n    if os.fork()==0:os._exit(0)\n'
        baseline = {p.name for p in Path('/proc').iterdir() if p.name.isdigit()}
        for attempt in range(64):
            self.assertTrue(server.evaluate('allowed-opens', source), attempt)
            for _ in range(200):
                extra = {p.name for p in Path('/proc').iterdir() if p.name.isdigit()} - baseline
                if not extra:
                    break
                time.sleep(0.01)
            self.assertEqual(extra, set(), f'unreaped processes after submission {attempt + 1}')
            self.assertEqual(zombies(), [], f'submission {attempt + 1}')

    def test_public_diagnostics_are_source_locations_only_private_is_generic(self):
        for source, line, kind in (('def bad(:\n', 1, 'SyntaxError'), ('# line one\nimport missing_learner_module\n', 2, 'ModuleNotFoundError'), ('# line one\nraise ValueError("private-path\\nBAD_TEXT")\n', 2, 'ValueError')):
            result = _WORKBENCH.run_public_tests({'auditor.py': source})
            self.assertEqual(result, {'passed': False, 'output': f'auditor.py:{line}: {kind}'})
            correct, message = server.evaluate_with_message('allowed-opens', source)
            self.assertFalse(correct)
            self.assertNotIn(kind, message)
            self.assertNotIn('BAD_TEXT', message)

    def test_deep_startup_json_is_not_a_verdict_and_worker_is_removed(self):
        source = 'print("["*2000+"0"+"]"*2000,flush=True)\nwhile True:pass\n'
        learner = LearnerSession({'auditor.py': source}, timeout=0.2)
        with self.assertRaises(LearnerError):
            with learner:
                pass
        self.assertIsNotNone(learner.process.returncode)
        self.assertFalse(Path(f'/proc/{learner.process.pid}').exists())

    def test_untrusted_diagnostic_shapes_are_rejected(self):
        learner = LearnerSession({'auditor.py': reference()})
        for value in ({'file': [], 'line': 1, 'type': 'Error'}, {'file': '/hidden/secret.py', 'line': 1, 'type': 'Error'}, {'file': 'auditor.py', 'line': True, 'type': 'Error'}, {'file': 'auditor.py', 'line': 1, 'type': 'Error\nPASS'}, {'file': 'auditor.py', 'line': 100000, 'type': 'Error'}):
            self.assertEqual(learner._initialization_diagnostic(value), '')


if __name__=="__main__":unittest.main()
