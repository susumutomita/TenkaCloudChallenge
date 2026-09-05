"""Author checks: actual visible instructions, wrapping edge cases, and submission boundary."""
from __future__ import annotations
import ast
import json
import contextlib
import io
import runpy
import os
from pathlib import Path
import re
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
METADATA = json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN') == '1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED, LINES, normalize_answer, setting, submission_binding, valid_binding
from participant.workbench import PortalEditorSupport
from participant.exercise import EXAMPLE, EXAMPLE_EXPECTED, call_row
from tests.hidden import check_zkvm_trace_drill
from verifier import server


def editor_solution(instructions: str):
    """Follow only the published copy-into-editor route, including supplied names."""
    blocks = re.findall(r'```python\n(.*?)\n```', instructions, re.S)
    if len(blocks) != len(LINES)-1:
        raise AssertionError('Only the seven teaching rows supply complete code')
    source = ast.parse((ROOT/'starter/zkvm_trace_drill.py').read_text())
    for fn in source.body:
        if not isinstance(fn, ast.FunctionDef) or fn.name not in LINES[:-1]:
            continue
        code = ast.parse(blocks[LINES.index(fn.name)]).body
        if not isinstance(code[-1], ast.Expr):
            raise AssertionError('The last line must be the expression to return')
        code[-1] = ast.Return(code[-1].value)
        fn.body = fn.body[:-1] + code
    module = types.ModuleType('participant_from_visible_rows')
    exec(compile(ast.fix_missing_locations(source), '<visible editor route>', 'exec'), module.__dict__)
    return module


class LearningContract(unittest.TestCase):
    def test_both_languages_work_when_copied_into_the_real_starter(self):
        # metadata is author input, not shipped in the participant image.
        metadata = METADATA
        for text in (metadata['instructions'], metadata['i18n']['en']['instructions']):
            learner = editor_solution(text)
            for seed in ('visible-1', 'visible-2', 'test-403', 'mask-18'):
                self.assertEqual(len(check_zkvm_trace_drill.run(learner, seed)), 2, seed)
                self.assertTrue(all('binding' in failure for failure in check_zkvm_trace_drill.run(learner, seed)))
            learner.binding = lambda m,l,o: [m-1,l+2,0]
            for seed in ('visible-1','visible-2','test-403','mask-18'):
                self.assertEqual(check_zkvm_trace_drill.run(learner, seed), [], seed)

    def test_copying_only_the_visible_code_leaves_the_construction_unfinished(self):
        learner = editor_solution(METADATA['instructions'])
        evidence = json.dumps(server.public_payload('reader-followup'))
        with patch.dict(sys.modules, {'zkvm_trace_drill': learner}), patch.dict(os.environ, {'PUBLIC_EVIDENCE_JSON': evidence}):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                with self.assertRaises(SystemExit) as result:
                    runpy.run_path(str(ROOT/'tests/public/test_zkvm_trace_drill.py'), run_name='__main__')
            self.assertEqual(result.exception.code, 1, output.getvalue())
            self.assertIn('FAIL binding', output.getvalue())
            self.assertIn('public tests: FAIL', output.getvalue())

    def test_public_tests_reject_numeric_boolean_results(self):
        learner = editor_solution(METADATA['instructions'])
        learner.decision = lambda m, discounts, limit: (1, 0)
        evidence = json.dumps(server.public_payload('reader-followup'))
        with patch.dict(sys.modules, {'zkvm_trace_drill': learner}), patch.dict(os.environ, {'PUBLIC_EVIDENCE_JSON': evidence}):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                with self.assertRaises(SystemExit) as result:
                    runpy.run_path(str(ROOT/'tests/public/test_zkvm_trace_drill.py'), run_name='__main__')
            self.assertEqual(result.exception.code, 1, output.getvalue())
            self.assertIn('FAIL decision', output.getvalue())

    def test_wrapping_is_per_step_and_includes_exact_boundary(self):
        learner = editor_solution(METADATA['instructions'])
        self.assertEqual(learner.trace(8, [7, 1, 1]), [7, 0, 1])
        self.assertEqual(learner.overflow(8, [7, 1, 1]), [False, True, False])
        self.assertEqual(learner.overflow(8, [0, 0, 0]), [False, False, False])
        self.assertEqual(learner.decision(8, [7, 1, 0], 0), (True, False))
        self.assertEqual(learner.decision(8, [1, 1, 1], 3), (True, True))

    def test_one_digit_example_has_the_documented_results(self):
        learner = editor_solution(METADATA['instructions'])
        for row in GRADED[:-1]:
            self.assertEqual(normalize_answer(row, call_row(learner, row, EXAMPLE)),
                             normalize_answer(row, EXAMPLE_EXPECTED[row]), row)

    def test_fixtures_preserve_four_distinct_case_roles(self):
        observed_orders = set()
        machines = set()
        for i in range(50):
            fixture = setting(f'coverage-{i}')
            public, answers = fixture['public'], fixture['expected']
            m = public['m']
            machines.add(m)
            self.assertIn(m, (8, 16))
            roles = []
            for case in public['cases']:
                self.assertTrue(all(0 <= n < m for n in case['discounts']))
                full = sum(case['discounts'])
                roles.append((full >= m, full % m <= case['limit']))
            self.assertEqual(set(roles), {(False, False), (False, True), (True, False), (True, True)})
            self.assertEqual(sum(answers['exploit']), 1)
            self.assertEqual(sum(answers['predicate']), 2)
            self.assertEqual(sum(answers['tamper']), 2)
            self.assertTrue(valid_binding(public, answers['binding']))
            observed_orders.add(tuple(roles))
        self.assertEqual(machines, {8, 16})
        self.assertGreater(len(observed_orders), 1)

    def test_construction_accepts_multiple_witnesses_but_rejects_both_wrong_decisions(self):
        public={'m':8,'limit':3,'other_limit':5}
        for value in ([7,5,0],[7,6,0],[0,5,7]):
            self.assertTrue(valid_binding(public,value))
        for value in ([7,1,0],[7,7,0],[8,4,0],[7,True,4],[7,5]):
            self.assertFalse(valid_binding(public,value))

    def test_boolean_answers_do_not_accept_numbers_or_missing_entries(self):
        for value in ('1,0', [1,0], [True], '', None):
            self.assertIsNone(normalize_answer('decision', value))
        self.assertEqual(normalize_answer('decision', '[True, False]'), (True, False))
        self.assertIsNone(normalize_answer('exact', True))


class SubmissionBoundary(unittest.TestCase):
    def workbench(self, root, seed):
        return PortalEditorSupport(root=root, deployment_binding=submission_binding(seed),
            problem_id=server.PROBLEM_ID, problem_name='test', description='test',
            submitted_files=('zkvm_trace_drill.py',), code_checkpoints=(), checkpoints=GRADED,
            checkpoint_labels={}, max_body_bytes=262144, run_timeout_seconds=5,
            max_output_bytes=65536, limit_fn=lambda: None)

    def test_learner_code_cannot_print_the_fixture_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'starter').mkdir()
            (root/'starter/zkvm_trace_drill.py').write_text('pass\n')
            (root/'tests/public').mkdir(parents=True)
            (root/'tests/public/test_probe.py').write_text(
                'import runpy\nfrom pathlib import Path\n'
                'runpy.run_path(str(Path(__file__).resolve().parents[2]/"starter/zkvm_trace_drill.py"))\n')
            with patch.dict(os.environ, {'FLAG_SEED':'fixture-seed-must-not-escape'}):
                result=self.workbench(root,'fixture-seed-must-not-escape').run_public_tests({
                    'zkvm_trace_drill.py':'import os\nprint("PROBE", os.environ.get("FLAG_SEED", "absent"))\n'})
            self.assertTrue(result['passed'], result['output'])
            self.assertIn('PROBE absent', result['output'])
            self.assertNotIn('fixture-seed-must-not-escape', result['output'])

    def test_prepare_and_verifier_keep_deployment_binding_without_sharing_seed(self):
        seed='binding-fixture'
        bench=self.workbench(ROOT,seed)
        answer=setting(seed)['expected']['exact']
        prepared=bench.prepare_submissions({'zkvm_trace_drill.py':'pass'}, {'exact':str(answer)})
        envelope=prepared['submissions']['exact']
        with patch.object(server,'SEED',seed):
            unpacked=server._unwrap_submission('exact',envelope)
            self.assertTrue(server.evaluate('exact',unpacked))
            self.assertIsNone(server._unwrap_submission('trace',envelope))
            self.assertIsNone(server._unwrap_submission('exact',str(answer)))
        with patch.object(server,'SEED','another-deployment'):
            self.assertIsNone(server._unwrap_submission('exact',envelope))
        payload=server.public_payload(seed)
        self.assertNotIn(seed,json.dumps(payload))
        self.assertNotIn('expected',payload)
        self.assertEqual(payload['submissionBinding'],submission_binding(seed))


if __name__ == '__main__':
    unittest.main()
