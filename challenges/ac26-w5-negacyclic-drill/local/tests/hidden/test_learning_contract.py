"""Author checks for the visible route, state transitions and submission boundary."""
from __future__ import annotations
import ast,contextlib,io,json,os,re,runpy,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
METADATA=json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN')=='1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED,LINES,normalize_answer,setting,submission_binding,valid_failure,valid_repair
from participant.workbench import PortalEditorSupport
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row
from tests.hidden import check_negacyclic_drill
from reference import negacyclic_drill as reference
from verifier import server


def editor_solution(text):
    blocks=re.findall(r'```python\n(.*?)\n```',text,re.S)
    assert len(blocks)==6,'Only the six teaching rows supply complete code'
    tree=ast.parse((ROOT/'starter/negacyclic_drill.py').read_text())
    for fn in tree.body:
        if isinstance(fn,ast.FunctionDef) and fn.name in LINES[:-2]:
            body=ast.parse(blocks[LINES.index(fn.name)]).body
            assert isinstance(body[-1],ast.Expr)
            body[-1]=ast.Return(body[-1].value)
            fn.body=fn.body[:-1]+body
    learner=types.ModuleType('visible_learner')
    exec(compile(ast.fix_missing_locations(tree),'<visible route>','exec'),learner.__dict__)
    return learner


def public_run(learner):
    evidence=json.dumps(server.public_payload('reader-negacyclic'))
    output=io.StringIO()
    with patch.dict(sys.modules,{'negacyclic_drill':learner}),patch.dict(os.environ,{'PUBLIC_EVIDENCE_JSON':evidence}),contextlib.redirect_stdout(output):
        try:runpy.run_path(str(ROOT/'tests/public/test_negacyclic_drill.py'),run_name='__main__')
        except SystemExit as result:return result.code,output.getvalue()
    raise AssertionError('public entrypoint did not terminate')


class LearningContract(unittest.TestCase):
    def test_published_rows_work_but_do_not_supply_the_closing_construction(self):
        for text in (METADATA['instructions'],METADATA['i18n']['en']['instructions']):
            learner=editor_solution(text)
            for seed in ('reader-negacyclic','one','two','three'):
                failures=check_negacyclic_drill.run(learner,seed)
                self.assertEqual(len(failures),4)
                self.assertTrue(all(any(row in failure for row in ('constants','margin')) for failure in failures))
            learner.constants=reference.constants
            learner.margin=reference.margin
            for seed in ('reader-negacyclic','one','two','three'):
                self.assertEqual(check_negacyclic_drill.run(learner,seed),[])

    def test_actual_public_route_needs_an_authored_final_answer(self):
        learner=editor_solution(METADATA['instructions'])
        status,output=public_run(learner)
        self.assertEqual(status,1,output);self.assertIn('FAIL margin',output)
        learner.constants=reference.constants
        learner.margin=reference.margin
        status,output=public_run(learner)
        self.assertEqual(status,0,output);self.assertIn('public tests: PASS',output)

    def test_signed_reads_cover_negative_and_multiple_laps(self):
        from participant.model import read
        self.assertEqual([read(4,i) for i in (-9,-8,-5,-4,-1,0,3,4,7,8,12)],[-1,1,1,-1,-1,1,1,-1,-1,1,-1])
        learner=editor_solution(METADATA['instructions'])
        self.assertEqual(learner.wrap(7,6,4),(1,-1,13))

    def test_original_noise_bound_and_counterexample_are_distinct(self):
        from participant.model import rotations,read
        for noise in (0,1):
            self.assertEqual([read(8,i) for i in rotations(16,8,noise)],[1,1,1,-1])
        self.assertEqual([read(8,i) for i in rotations(16,8,2)],[1,-1,-1,-1])
        # Positive distance n-3D is 5 here; actual failure already occurs at noise 2.
        self.assertLess(2,8-3)

    def test_fixtures_vary_probes_and_noise_without_removing_either_construction(self):
        noises=set();bounds=set();probe_sets=set()
        for i in range(30):
            fixture=setting(f'coverage-{i}');public=fixture['public'];expected=fixture['expected']
            self.assertEqual(check_negacyclic_drill.run(reference,f'coverage-{i}'),[])
            self.assertEqual((public['p'],public['n']),(16,8))
            self.assertLessEqual(public['noise_a']+public['noise_b'],public['dmax'])
            self.assertEqual(set(expected['signs']),{1,-1})
            self.assertTrue(valid_failure(public,expected['constants']))
            self.assertTrue(valid_repair(public,expected['margin']))
            noises.add(public['noise_a']+public['noise_b']);bounds.add(public['repair_noise']);probe_sets.add(tuple(public['probes']))
        self.assertEqual(noises,{0,1});self.assertEqual(bounds,{2,3});self.assertGreater(len(probe_sets),20)

    def test_construction_predicates_enforce_all_public_conditions(self):
        from participant.model import valid_failure as public_failure,valid_repair as public_repair
        for noise in (2,3):
            public={**EXAMPLE,'repair_noise':noise}
            self.assertTrue(valid_failure(public,[0,1,2]))
            self.assertTrue(valid_failure(public,[1,0,2]))
            self.assertTrue(valid_repair(public,[3,2,2]))
            for wrong in ([0,1,0],[0,1,1],[0,1,4],[0,0,2],[2,1,2],[True,1,2],None):
                self.assertFalse(valid_failure(public,wrong))
                self.assertFalse(public_failure(public,wrong))
            for wrong in ([1,1,1],[16,2,2],[3,2],[True,2,2],None):
                self.assertFalse(valid_repair(public,wrong))
                self.assertFalse(public_repair(public,wrong))
            # Independent implementations agree across every allowed coefficient triple.
            for bias in range(16):
                for wa in range(16):
                    for wb in range(16):
                        triple=[bias,wa,wb]
                        self.assertEqual(valid_repair(public,triple),public_repair(public,triple))

    def test_answer_normalization_enforces_types_and_widths(self):
        self.assertIsNone(normalize_answer('boundary',True))
        self.assertIsNone(normalize_answer('boundary',8.0))
        self.assertIsNone(normalize_answer('constants',[0,1]))
        self.assertIsNone(normalize_answer('margin',[3,2,True]))
        self.assertEqual(normalize_answer('margin','3,2,2'),(3,2,2))


class SubmissionBoundary(unittest.TestCase):
    def workbench(self, root, seed):
        return PortalEditorSupport(root=root, deployment_binding=submission_binding(seed),
            problem_id=server.PROBLEM_ID, problem_name='test', description='test',
            submitted_files=('negacyclic_drill.py',), code_checkpoints=(), checkpoints=GRADED,
            checkpoint_labels={}, max_body_bytes=262144, run_timeout_seconds=5,
            max_output_bytes=65536, limit_fn=lambda: None)

    def test_learner_code_cannot_print_the_fixture_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'starter').mkdir()
            (root/'starter/negacyclic_drill.py').write_text('pass\n')
            (root/'tests/public').mkdir(parents=True)
            (root/'tests/public/test_probe.py').write_text(
                'import runpy\nfrom pathlib import Path\n'
                'runpy.run_path(str(Path(__file__).resolve().parents[2]/"starter/negacyclic_drill.py"))\n')
            with patch.dict(os.environ, {'FLAG_SEED':'fixture-seed-must-not-escape'}):
                result=self.workbench(root,'fixture-seed-must-not-escape').run_public_tests({
                    'negacyclic_drill.py':'import os\nprint("PROBE", os.environ.get("FLAG_SEED", "absent"))\n'})
            self.assertTrue(result['passed'], result['output'])
            self.assertIn('PROBE absent', result['output'])
            self.assertNotIn('fixture-seed-must-not-escape', result['output'])

    def test_prepare_and_verifier_keep_deployment_binding_without_sharing_seed(self):
        seed='binding-fixture'
        bench=self.workbench(ROOT,seed)
        answer=setting(seed)['expected']['boundary']
        prepared=bench.prepare_submissions({'negacyclic_drill.py':'pass'}, {'boundary':str(answer)})
        envelope=prepared['submissions']['boundary']
        with patch.object(server,'SEED',seed):
            unpacked=server._unwrap_submission('boundary',envelope)
            self.assertTrue(server.evaluate('boundary',unpacked))
            self.assertIsNone(server._unwrap_submission('wrap',envelope))
            self.assertIsNone(server._unwrap_submission('boundary',str(answer)))
        with patch.object(server,'SEED','another-deployment'):
            self.assertIsNone(server._unwrap_submission('boundary',envelope))
        payload=server.public_payload(seed)
        self.assertNotIn(seed,json.dumps(payload))
        self.assertNotIn('expected',payload)
        self.assertEqual(payload['submissionBinding'],submission_binding(seed))


if __name__ == '__main__':
    unittest.main()
