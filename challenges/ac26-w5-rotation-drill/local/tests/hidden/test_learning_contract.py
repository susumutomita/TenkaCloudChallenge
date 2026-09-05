"""Author checks for the visible route, state transitions and submission boundary."""
from __future__ import annotations
import ast,contextlib,io,json,os,re,runpy,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
METADATA=json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN')=='1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED,LINES,normalize_answer,setting,submission_binding,valid_window,valid_edge
from participant.workbench import PortalEditorSupport
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row
from tests.hidden import check_rotation_drill
from reference import rotation_drill as reference
from verifier import server


def editor_solution(text):
    blocks=re.findall(r'```python\n(.*?)\n```',text,re.S)
    assert len(blocks)==6,'Only the six teaching rows supply complete code'
    tree=ast.parse((ROOT/'starter/rotation_drill.py').read_text())
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
    evidence=json.dumps(server.public_payload('reader-rotation'))
    output=io.StringIO()
    with patch.dict(sys.modules,{'rotation_drill':learner}),patch.dict(os.environ,{'PUBLIC_EVIDENCE_JSON':evidence}),contextlib.redirect_stdout(output):
        try:runpy.run_path(str(ROOT/'tests/public/test_rotation_drill.py'),run_name='__main__')
        except SystemExit as result:return result.code,output.getvalue()
    raise AssertionError('public entrypoint did not terminate')


class LearningContract(unittest.TestCase):
    def test_published_rows_work_but_do_not_supply_the_closing_construction(self):
        for text in (METADATA['instructions'],METADATA['i18n']['en']['instructions']):
            learner=editor_solution(text)
            for seed in ('reader-rotation','one','two','three'):
                failures=check_rotation_drill.run(learner,seed)
                self.assertEqual(len(failures),4)
                self.assertTrue(all(any(row in failure for row in ('window','edge')) for failure in failures))
            learner.window=reference.window
            learner.edge=reference.edge
            for seed in ('reader-rotation','one','two','three'):
                self.assertEqual(check_rotation_drill.run(learner,seed),[])

    def test_actual_public_route_needs_an_authored_final_answer(self):
        learner=editor_solution(METADATA['instructions'])
        status,output=public_run(learner)
        self.assertEqual(status,1,output);self.assertIn('FAIL edge',output)
        learner.window=reference.window
        learner.edge=reference.edge
        status,output=public_run(learner)
        self.assertEqual(status,0,output);self.assertIn('public tests: PASS',output)

    def test_rounding_is_ties_to_even_not_truncation_or_half_up(self):
        from participant.model import rh
        self.assertEqual([rh(16,4,x) for x in (1,3,5,7)],[0,2,2,4])
        learner=editor_solution(METADATA['instructions'])
        self.assertEqual(learner.index(16,4,[1],[1],2),1)
        # Rounding after subtracting would instead give zero.
        self.assertEqual(rh(16,4,(2-1)%16),0)

    def test_every_shape_and_shift_has_both_constructions(self):
        from fixtures.generate import SHAPES
        for p,n,q in SHAPES:
            for shift in range(1,p//2):
                public={'p':p,'n':n,'q':q,'shift':shift,'offsets':[-1,0] if 2*n//p==2 else [-1,0,1]}
                self.assertTrue(valid_window(public,reference.window(p,q,n,shift)))
                self.assertTrue(valid_edge(public,reference.edge(p,n,shift,public['offsets'])))

    def test_varied_fixtures_preserve_small_numbers_and_the_readout(self):
        from participant.model import read,table,rh
        shapes=set()
        for i in range(80):
            fixture=setting(f'coverage-{i}');public=fixture['public'];expected=fixture['expected']
            p,q,n,s,a,b,shift=[public[k] for k in ('p','q','n','s','a','b','shift')]
            shapes.add((p,n,q))
            self.assertIn(n,(4,8));self.assertLessEqual(max(a),9);self.assertLess(b,32)
            self.assertEqual(check_rotation_drill.run(reference,f'coverage-{i}'),[])
            self.assertTrue(valid_window(public,expected['window']))
            self.assertTrue(valid_edge(public,expected['edge']))
            D=q//p;inner=sum(x*y for x,y in zip(a,s));noise=(b-inner)%q%D
            for message in range(p//2):
                body=(inner+D*message+noise)%q
                index=(rh(q,n,body)-sum(rh(q,n,x)*y for x,y in zip(a,s)))%(2*n)
                self.assertEqual(read(table(p,n,shift),index),(message+shift)%(p//2))
        self.assertEqual(len(shapes),2)

    def test_constructions_require_answers_to_differ_and_all_offsets_to_work(self):
        from participant.model import valid_window as public_window,valid_edge as public_edge
        # These are author-generated witnesses; the statement gives no completed pair/table.
        for seed in ('reader-rotation','a','b','c'):
            public=setting(seed)['public'];p,q,n,shift=[public[k] for k in ('p','q','n','shift')]
            pair=reference.window(p,q,n,shift)
            self.assertTrue(valid_window(public,pair))
            for invalid in ([0,0],pair[:1],[q,pair[1]],[True,pair[1]],None):
                self.assertFalse(valid_window(public,invalid))
                self.assertFalse(public_window(public,invalid))
            values=reference.edge(p,n,shift,public['offsets'])
            self.assertTrue(valid_edge(public,values))
            self.assertFalse(valid_edge(public,reference.testpoly(p,n,shift)))
            for invalid in (values[:-1],[0]*n,[p]*n,[True]*n,None):
                self.assertFalse(valid_edge(public,invalid))
                self.assertFalse(public_edge(public,invalid))
            # Independent public/private predicates agree across the full pair space.
            for a in range(q):
                for b in range(q):
                    self.assertEqual(valid_window(public,[a,b]),public_window(public,[a,b]))
            self.assertTrue(public_edge(public,values))
        # Distinct positions 2 and 1 both read zero: not a distinguishing pair.
        self.assertFalse(valid_window(EXAMPLE,[1,4]))
        # The last entry carries the negative-position condition; dropping its sign fails.
        self.assertTrue(valid_edge(EXAMPLE,[1,0,0,-1]))
        self.assertFalse(valid_edge(EXAMPLE,[1,0,0,1]))
        self.assertFalse(valid_edge(EXAMPLE,[1,1,0,-1]))
        # Entry 2 may be free in another offset configuration: accept any valid table.
        public={**EXAMPLE,'offsets':[0]}
        self.assertTrue(valid_edge(public,[1,1,0,-1]))
        self.assertTrue(valid_edge(public,[1,0,0,0]))

    def test_answer_normalization_rejects_boolean_float_and_wrong_shapes(self):
        self.assertIsNone(normalize_answer('phase',True))
        self.assertIsNone(normalize_answer('phase',1.0))
        self.assertIsNone(normalize_answer('params',[4,16,4]))
        self.assertIsNone(normalize_answer('window',[1,2,3]))
        self.assertIsNone(normalize_answer('edge',[True,0,0,-1]))
        self.assertEqual(normalize_answer('window','[1,2]'),(1,2))
        self.assertEqual(normalize_answer('params','4,16,4,4'),(4,16,4,4))


class SubmissionBoundary(unittest.TestCase):
    def workbench(self, root, seed):
        return PortalEditorSupport(root=root, deployment_binding=submission_binding(seed),
            problem_id=server.PROBLEM_ID, problem_name='test', description='test',
            submitted_files=('rotation_drill.py',), code_checkpoints=(), checkpoints=GRADED,
            checkpoint_labels={}, max_body_bytes=262144, run_timeout_seconds=5,
            max_output_bytes=65536, limit_fn=lambda: None)

    def test_learner_code_cannot_print_the_fixture_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'starter').mkdir()
            (root/'starter/rotation_drill.py').write_text('pass\n')
            (root/'tests/public').mkdir(parents=True)
            (root/'tests/public/test_probe.py').write_text(
                'import runpy\nfrom pathlib import Path\n'
                'runpy.run_path(str(Path(__file__).resolve().parents[2]/"starter/rotation_drill.py"))\n')
            with patch.dict(os.environ, {'FLAG_SEED':'fixture-seed-must-not-escape'}):
                result=self.workbench(root,'fixture-seed-must-not-escape').run_public_tests({
                    'rotation_drill.py':'import os\nprint("PROBE", os.environ.get("FLAG_SEED", "absent"))\n'})
            self.assertTrue(result['passed'], result['output'])
            self.assertIn('PROBE absent', result['output'])
            self.assertNotIn('fixture-seed-must-not-escape', result['output'])

    def test_prepare_and_verifier_keep_deployment_binding_without_sharing_seed(self):
        seed='binding-fixture'
        bench=self.workbench(ROOT,seed)
        answer=setting(seed)['expected']['phase']
        prepared=bench.prepare_submissions({'rotation_drill.py':'pass'}, {'phase':str(answer)})
        envelope=prepared['submissions']['phase']
        with patch.object(server,'SEED',seed):
            unpacked=server._unwrap_submission('phase',envelope)
            self.assertTrue(server.evaluate('phase',unpacked))
            self.assertIsNone(server._unwrap_submission('index',envelope))
            self.assertIsNone(server._unwrap_submission('phase',str(answer)))
        with patch.object(server,'SEED','another-deployment'):
            self.assertIsNone(server._unwrap_submission('phase',envelope))
        payload=server.public_payload(seed)
        self.assertNotIn(seed,json.dumps(payload))
        self.assertNotIn('expected',payload)
        self.assertEqual(payload['submissionBinding'],submission_binding(seed))


if __name__ == '__main__':
    unittest.main()
