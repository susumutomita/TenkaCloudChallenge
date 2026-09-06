"""Author checks for the visible route, state transitions and submission boundary."""
from __future__ import annotations
import ast,contextlib,io,itertools,json,os,re,runpy,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
METADATA=json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN')=='1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED,LINES,normalize_answer,setting,submission_binding,valid_spoof,valid_pair
from participant.workbench import PortalEditorSupport
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row
from tests.hidden import check_sumcheck_drill
from reference import sumcheck_drill as reference
from verifier import server


def editor_solution(text):
    blocks=re.findall(r'```python\n(.*?)\n```',text,re.S)
    assert len(blocks)==6,'Only the six teaching rows supply complete code'
    tree=ast.parse((ROOT/'starter/sumcheck_drill.py').read_text())
    for fn in tree.body:
        if isinstance(fn,ast.FunctionDef) and fn.name in [row.replace('-','_') for row in LINES[:-2]]:
            body=ast.parse(blocks[LINES.index(fn.name.replace('_','-'))]).body
            assert isinstance(body[-1],ast.Expr)
            body[-1]=ast.Return(body[-1].value)
            fn.body=fn.body[:-1]+body
    learner=types.ModuleType('visible_learner')
    exec(compile(ast.fix_missing_locations(tree),'<visible route>','exec'),learner.__dict__)
    return learner


def public_run(learner):
    evidence=json.dumps(server.public_payload('reader-sumcheck'))
    output=io.StringIO()
    with patch.dict(sys.modules,{'sumcheck_drill':learner}),patch.dict(os.environ,{'PUBLIC_EVIDENCE_JSON':evidence}),contextlib.redirect_stdout(output):
        try:runpy.run_path(str(ROOT/'tests/public/test_sumcheck_drill.py'),run_name='__main__')
        except SystemExit as result:return result.code,output.getvalue()
    raise AssertionError('public entrypoint did not terminate')


class LearningContract(unittest.TestCase):
    def test_published_rows_work_but_do_not_supply_the_closing_construction(self):
        for text in (METADATA['instructions'],METADATA['i18n']['en']['instructions']):
            learner=editor_solution(text)
            for seed in ('reader-sumcheck','one','two','three'):
                failures=check_sumcheck_drill.run(learner,seed)
                self.assertEqual(len(failures),4)
                self.assertTrue(all(any(row in failure for row in ('lie-caught','miss-points')) for failure in failures))
            learner.lie_caught=reference.lie_caught
            learner.miss_points=reference.miss_points
            for seed in ('reader-sumcheck','one','two','three'):
                self.assertEqual(check_sumcheck_drill.run(learner,seed),[])

    def test_actual_public_route_needs_an_authored_final_answer(self):
        learner=editor_solution(METADATA['instructions'])
        status,output=public_run(learner)
        self.assertEqual(status,1,output);self.assertIn('FAIL miss-points',output)
        learner.lie_caught=reference.lie_caught
        learner.miss_points=reference.miss_points
        status,output=public_run(learner)
        self.assertEqual(status,0,output);self.assertIn('public tests: PASS',output)

    def test_honest_messages_preserve_both_sums_and_the_final_check(self):
        from participant.model import layer,wired,poly
        for seed in range(80):
            public=setting(f'coverage-{seed}')['public'];p=public['p']
            y0,y1,total=layer(p,public['x'])
            for t in range(p):
                self.assertEqual(poly(p,public['first'],t),(wired(p,y0,y1,t,0)+wired(p,y0,y1,t,1))%p)
                self.assertEqual(poly(p,public['second'],t),wired(p,y0,y1,public['r1'],t))
            self.assertEqual((poly(p,public['first'],0)+poly(p,public['first'],1))%p,total)
            self.assertEqual((poly(p,public['second'],0)+poly(p,public['second'],1))%p,poly(p,public['first'],public['r1']))

    def test_small_fixtures_vary_all_graded_results_and_keep_constructions(self):
        seen={row:set() for row in GRADED};primes=set();positions=set()
        for i in range(80):
            fixture=setting(f'coverage-{i}');public=fixture['public'];expected=fixture['expected']
            self.assertEqual(check_sumcheck_drill.run(reference,f'coverage-{i}'),[])
            primes.add(public['p']);positions.add(public['r2'])
            self.assertTrue(all(0<=v<public['p'] for key in ('x','first','second') for v in public[key]))
            self.assertGreaterEqual(public['r1'],2)
            self.assertNotEqual(expected['lie'][1],expected['round1'][1])
            self.assertTrue(valid_spoof(public,expected['lie-caught']))
            self.assertTrue(valid_pair(public,expected['miss-points']))
            for row in GRADED:seen[row].add(expected[row])
        self.assertEqual(primes,{5,7});self.assertEqual(positions,set(range(7)))
        self.assertTrue(all(len(values)>1 for values in seen.values()),seen)

    def test_independent_predicates_agree_for_all_candidates_and_valid_pairs(self):
        from participant.model import valid_spoof as public_spoof,valid_pair as public_pair,poly
        for i in range(12):
            public=setting(f'predicates-{i}')['public'];p=public['p']
            for candidate in itertools.product(range(p),repeat=3):
                self.assertEqual(valid_spoof(public,candidate),public_spoof(public,candidate))
            claim=(poly(p,public['first'],public['r1'])+public['d']*(1-public['r1']))%p
            eligible=[c for c in itertools.product(range(p),repeat=3) if (2*c[0]+c[1]+c[2])%p==claim]
            for left in eligible:
                for right in eligible:
                    self.assertEqual(valid_pair(public,[left,right]),public_pair(public,[left,right]))

    def test_false_message_needs_both_sum_and_point_and_pair_needs_disjointness(self):
        from participant.model import poly
        public=EXAMPLE;fixture=setting('construction-negative');p=public['p']
        for bad in (None,[True,2,3],[-1,2,3],[p,2,3],[1,2],[1,2,3,4],public['second']):
            self.assertFalse(valid_spoof(public,bad))
        # Each valid false expression has the wrong claimed sum, so the honest
        # expression is never accepted. Altering only its constant cannot preserve
        # agreement at the revealed point.
        shifted=list(public['second']);shifted[0]=1
        self.assertFalse(valid_spoof(public,shifted))
        pair=reference.miss_points(*[public[k] for k in ('p','first','second','r1','d')])
        self.assertTrue(valid_pair(public,pair))
        self.assertFalse(valid_pair(public,[pair[0],pair[0]]))
        self.assertFalse(valid_pair(public,[pair[0],public['second']]))
        self.assertFalse(valid_pair(public,[pair[0]]))
        matches=[[t for t in range(p) if poly(p,c,t)==poly(p,public['second'],t)] for c in pair]
        self.assertEqual([len(m) for m in matches],[2,2])
        self.assertFalse(set(matches[0])&set(matches[1]))

    def test_answer_normalization_enforces_nested_types_and_widths(self):
        self.assertIsNone(normalize_answer('round1',True))
        self.assertIsNone(normalize_answer('round1',[1,2.0]))
        self.assertIsNone(normalize_answer('lie-caught',[0,1]))
        self.assertIsNone(normalize_answer('miss-points',[[0,1,2],[0,1,True]]))
        self.assertEqual(normalize_answer('miss-points','[[0,1,2],[3,4,0]]'),((0,1,2),(3,4,0)))


class SubmissionBoundary(unittest.TestCase):
    def workbench(self, root, seed):
        return PortalEditorSupport(root=root, deployment_binding=submission_binding(seed),
            problem_id=server.PROBLEM_ID, problem_name='test', description='test',
            submitted_files=('sumcheck_drill.py',), code_checkpoints=(), checkpoints=GRADED,
            checkpoint_labels={}, max_body_bytes=262144, run_timeout_seconds=5,
            max_output_bytes=65536, limit_fn=lambda: None)

    def test_learner_code_cannot_print_the_fixture_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'starter').mkdir()
            (root/'starter/sumcheck_drill.py').write_text('pass\n')
            (root/'tests/public').mkdir(parents=True)
            (root/'tests/public/test_probe.py').write_text(
                'import runpy\nfrom pathlib import Path\n'
                'runpy.run_path(str(Path(__file__).resolve().parents[2]/"starter/sumcheck_drill.py"))\n')
            with patch.dict(os.environ, {'FLAG_SEED':'fixture-seed-must-not-escape'}):
                result=self.workbench(root,'fixture-seed-must-not-escape').run_public_tests({
                    'sumcheck_drill.py':'import os\nprint("PROBE", os.environ.get("FLAG_SEED", "absent"))\n'})
            self.assertTrue(result['passed'], result['output'])
            self.assertIn('PROBE absent', result['output'])
            self.assertNotIn('fixture-seed-must-not-escape', result['output'])

    def test_prepare_and_verifier_keep_deployment_binding_without_sharing_seed(self):
        seed='binding-fixture'
        bench=self.workbench(ROOT,seed)
        answer=setting(seed)['expected']['circuit']
        prepared=bench.prepare_submissions({'sumcheck_drill.py':'pass'}, {'circuit':str(answer)})
        envelope=prepared['submissions']['circuit']
        with patch.object(server,'SEED',seed):
            unpacked=server._unwrap_submission('circuit',envelope)
            self.assertTrue(server.evaluate('circuit',unpacked))
            self.assertIsNone(server._unwrap_submission('mle',envelope))
            self.assertIsNone(server._unwrap_submission('circuit',str(answer)))
        with patch.object(server,'SEED','another-deployment'):
            self.assertIsNone(server._unwrap_submission('circuit',envelope))
        payload=server.public_payload(seed)
        self.assertNotIn(seed,json.dumps(payload))
        self.assertNotIn('expected',payload)
        self.assertEqual(payload['submissionBinding'],submission_binding(seed))


if __name__ == '__main__':
    unittest.main()
