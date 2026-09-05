"""Author checks for the visible route, state transitions and submission boundary."""
from __future__ import annotations
import ast,contextlib,io,json,os,re,runpy,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
METADATA=json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN')=='1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED,LINES,normalize_answer,setting,submission_binding
from participant.workbench import PortalEditorSupport
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row
from tests.hidden import check_nullifier_drill
from verifier import server


def editor_solution(text):
    blocks=re.findall(r'```python\n(.*?)\n```',text,re.S)
    assert len(blocks)==7,'Only the seven teaching rows supply complete code'
    tree=ast.parse((ROOT/'starter/nullifier_drill.py').read_text())
    for fn in tree.body:
        if isinstance(fn,ast.FunctionDef) and fn.name in LINES[:-1]:
            body=ast.parse(blocks[LINES.index(fn.name)]).body
            assert isinstance(body[-1],ast.Expr)
            body[-1]=ast.Return(body[-1].value)
            fn.body=fn.body[:-1]+body
    learner=types.ModuleType('visible_learner')
    exec(compile(ast.fix_missing_locations(tree),'<visible route>','exec'),learner.__dict__)
    return learner


def public_run(learner):
    evidence=json.dumps(server.public_payload('reader-nullifier'))
    output=io.StringIO()
    with patch.dict(sys.modules,{'nullifier_drill':learner}),patch.dict(os.environ,{'PUBLIC_EVIDENCE_JSON':evidence}),contextlib.redirect_stdout(output):
        try:runpy.run_path(str(ROOT/'tests/public/test_nullifier_drill.py'),run_name='__main__')
        except SystemExit as result:return result.code,output.getvalue()
    raise AssertionError('public entrypoint did not terminate')


class LearningContract(unittest.TestCase):
    def test_published_rows_work_but_do_not_supply_the_closing_construction(self):
        for text in (METADATA['instructions'],METADATA['i18n']['en']['instructions']):
            learner=editor_solution(text)
            for seed in ('reader-nullifier','one','two','three'):
                failures=check_nullifier_drill.run(learner,seed)
                self.assertEqual(len(failures),2)
                self.assertTrue(all('collision' in failure for failure in failures))
            learner.collision=lambda p,secret,scope:p-secret
            for seed in ('reader-nullifier','one','two','three'):
                self.assertEqual(check_nullifier_drill.run(learner,seed),[])

    def test_actual_public_route_needs_an_authored_final_answer(self):
        learner=editor_solution(METADATA['instructions'])
        status,output=public_run(learner)
        self.assertEqual(status,1,output);self.assertIn('FAIL collision',output)
        learner.collision=lambda p,secret,scope:p-secret
        status,output=public_run(learner)
        self.assertEqual(status,0,output);self.assertIn('public tests: PASS',output)

    def test_public_boolean_outputs_must_not_be_numeric_flags(self):
        learner=editor_solution(METADATA['instructions'])
        learner.accept=lambda scope,attempts:[0,1,0,0,1,1]
        status,output=public_run(learner)
        self.assertEqual(status,1);self.assertIn('FAIL accept',output)

    def test_invalid_request_does_not_consume_a_valid_voters_marker(self):
        learner=editor_solution(METADATA['instructions'])
        attempts=[{'verified':False,'scope':1,'nullifier':2},{'verified':True,'scope':1,'nullifier':2},{'verified':True,'scope':1,'nullifier':2}]
        self.assertEqual(learner.accept(1,attempts),[False,True,False])
        self.assertEqual(learner.count(1,attempts),1)
        self.assertEqual(learner.unchecked(1,attempts),[True,False,False])
        attempts[0]={'verified':True,'scope':2,'nullifier':2}
        self.assertEqual(learner.accept(1,attempts),[False,True,False])

    def test_same_vote_and_changed_vote_under_the_bad_design(self):
        learner=editor_solution(METADATA['instructions'])
        self.assertEqual(learner.message(7,2,1,[0,0]),[True,False])
        self.assertEqual(learner.message(7,2,1,[0,1]),[True,True])
        self.assertEqual(learner.repeat(7,2,1,[0,1]),[5,5])
        self.assertEqual(learner.scopes(7,2,[1,2]),[5,6])

    def test_fixtures_vary_without_removing_the_counterexamples(self):
        counts=set(); message_outcomes=set(); divisors=set()
        for i in range(50):
            fixture=setting(f'coverage-{i}');public=fixture['public'];answers=fixture['expected']
            p=public['p'];secret=public['secret'];other=answers['collision'];scope=public['scope']
            self.assertTrue(0<secret<p and 0<=other<p and other!=secret)
            self.assertEqual((secret*secret+scope)%p,(other*other+scope)%p)
            self.assertEqual(len(public['attempts']),6)
            for attempt in public['attempts']:
                if attempt['verified']:
                    self.assertIn(attempt['nullifier'], {(s*s+attempt['scope'])%p for s in range(p)})
            self.assertEqual(sum(answers['accept']),answers['count'])
            self.assertIn(sum(answers['unchecked']),(1,2))
            counts.add(answers['count']);message_outcomes.add(answers['message']);divisors.add(p)
        self.assertEqual(counts,{2,3})
        self.assertEqual(message_outcomes,{(True,True),(True,False)})
        self.assertEqual(divisors,{5,7})

    def test_answer_normalization_enforces_shape_and_type(self):
        self.assertIsNone(normalize_answer('accept',[0,1,0,0,1,1]))
        self.assertIsNone(normalize_answer('label',True))
        self.assertIsNone(normalize_answer('repeat',[5]))
        self.assertEqual(normalize_answer('message','[True,False]'),(True,False))


class SubmissionBoundary(unittest.TestCase):
    def workbench(self, root, seed):
        return PortalEditorSupport(root=root, deployment_binding=submission_binding(seed),
            problem_id=server.PROBLEM_ID, problem_name='test', description='test',
            submitted_files=('nullifier_drill.py',), code_checkpoints=(), checkpoints=GRADED,
            checkpoint_labels={}, max_body_bytes=262144, run_timeout_seconds=5,
            max_output_bytes=65536, limit_fn=lambda: None)

    def test_learner_code_cannot_print_the_fixture_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'starter').mkdir()
            (root/'starter/nullifier_drill.py').write_text('pass\n')
            (root/'tests/public').mkdir(parents=True)
            (root/'tests/public/test_probe.py').write_text(
                'import runpy\nfrom pathlib import Path\n'
                'runpy.run_path(str(Path(__file__).resolve().parents[2]/"starter/nullifier_drill.py"))\n')
            with patch.dict(os.environ, {'FLAG_SEED':'fixture-seed-must-not-escape'}):
                result=self.workbench(root,'fixture-seed-must-not-escape').run_public_tests({
                    'nullifier_drill.py':'import os\nprint("PROBE", os.environ.get("FLAG_SEED", "absent"))\n'})
            self.assertTrue(result['passed'], result['output'])
            self.assertIn('PROBE absent', result['output'])
            self.assertNotIn('fixture-seed-must-not-escape', result['output'])

    def test_prepare_and_verifier_keep_deployment_binding_without_sharing_seed(self):
        seed='binding-fixture'
        bench=self.workbench(ROOT,seed)
        answer=setting(seed)['expected']['label']
        prepared=bench.prepare_submissions({'nullifier_drill.py':'pass'}, {'label':str(answer)})
        envelope=prepared['submissions']['label']
        with patch.object(server,'SEED',seed):
            unpacked=server._unwrap_submission('label',envelope)
            self.assertTrue(server.evaluate('label',unpacked))
            self.assertIsNone(server._unwrap_submission('repeat',envelope))
            self.assertIsNone(server._unwrap_submission('label',str(answer)))
        with patch.object(server,'SEED','another-deployment'):
            self.assertIsNone(server._unwrap_submission('label',envelope))
        payload=server.public_payload(seed)
        self.assertNotIn(seed,json.dumps(payload))
        self.assertNotIn('expected',payload)
        self.assertEqual(payload['submissionBinding'],submission_binding(seed))


if __name__ == '__main__':
    unittest.main()
