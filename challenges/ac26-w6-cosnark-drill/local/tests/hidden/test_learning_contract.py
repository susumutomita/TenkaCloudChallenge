"""Author checks: actual visible instructions, mask edge cases, and submission boundary."""
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
from fixtures.generate import GRADED, LINES, PRIMES, setting, submission_binding
from participant.workbench import PortalEditorSupport
from tests.hidden import check_co_snark_drill
from verifier import server


def editor_solution(instructions: str):
    """Follow only the published copy-into-editor route, including supplied names."""
    blocks = re.findall(r'```python\n(.*?)\n```', instructions, re.S)
    if len(blocks) != len(LINES):
        raise AssertionError('Each visible row must have one runnable code block')
    source = ast.parse((ROOT/'starter/co_snark_drill.py').read_text())
    for fn in source.body:
        if not isinstance(fn, ast.FunctionDef) or fn.name not in LINES:
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
                self.assertEqual(check_co_snark_drill.run(learner, seed), [], seed)

    def test_visible_solution_passes_the_actual_public_test_route(self):
        learner = editor_solution(METADATA['instructions'])
        evidence = json.dumps(server.public_payload('reader-followup'))
        with patch.dict(sys.modules, {'co_snark_drill': learner}), patch.dict(os.environ, {'PUBLIC_EVIDENCE_JSON': evidence}):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                with self.assertRaises(SystemExit) as result:
                    runpy.run_path(str(ROOT/'tests/public/test_co_snark_drill.py'), run_name='__main__')
            self.assertEqual(result.exception.code, 0, output.getvalue())
            self.assertIn('public tests: PASS', output.getvalue())

    def test_zero_equal_and_secret_equal_masks_are_not_rerolled(self):
        # Conditioning on any of these would change the privacy model.
        for mask in range(PRIMES[0]):
            def draw(seed, label, low, high):
                return 0 if label == 'prime' else mask
            with patch('fixtures.generate._draw', side_effect=draw) as draws:
                fixture = setting('all-equal')
            self.assertEqual(fixture['public']['r0'], mask)
            self.assertEqual(fixture['public']['w'][0], mask)
            self.assertEqual(fixture['public']['a'], fixture['public']['b'])
            self.assertEqual(draws.call_count, 14)
            self.assertEqual(fixture['expected']['csum'], fixture['expected']['crossmul'][1])
        # A legitimate coincident product must remain accepted, not be rerolled.
        with patch('fixtures.generate._draw', return_value=0):
            self.assertEqual(setting('zero')['expected']['crossmul'], (0, 0))

    def test_one_digit_example_has_the_documented_results(self):
        # Independent, hand-computed observer example from the statement.
        values = dict(p=7,w=[2,3],r0=1,r1=2,ca=[1,2],cb=[2,1],a=4,b=5,ra=1,rb=3,rc=2)
        metadata = METADATA
        blocks = re.findall(r'```python\n(.*?)\n```', metadata['instructions'], re.S)
        observed={}
        for row,block in zip(LINES,blocks):
            parsed=ast.parse(block)
            expr=parsed.body.pop()
            exec(compile(parsed, '<visible row>', 'exec'), values)
            observed[row]=eval(compile(ast.Expression(expr.value), '<visible output>', 'eval'), values)
        self.assertEqual(observed['shares'], (1,1))
        self.assertEqual(observed['ashares'], [5,3])
        self.assertEqual(observed['aopen'], (1,1))
        self.assertEqual(observed['bshares'], (4,3,0))
        self.assertEqual(observed['crossmul'], (1,0))
        self.assertEqual(observed['beaveropen'], (4,2))
        self.assertEqual(observed['cshares'], [3,4])
        self.assertEqual(observed['csum'], 0)


class SubmissionBoundary(unittest.TestCase):
    def workbench(self, root, seed):
        return PortalEditorSupport(root=root, deployment_binding=submission_binding(seed),
            problem_id=server.PROBLEM_ID, problem_name='test', description='test',
            submitted_files=('co_snark_drill.py',), code_checkpoints=(), checkpoints=GRADED,
            checkpoint_labels={}, max_body_bytes=262144, run_timeout_seconds=5,
            max_output_bytes=65536, limit_fn=lambda: None)

    def test_learner_code_cannot_print_the_fixture_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'starter').mkdir()
            (root/'starter/co_snark_drill.py').write_text('pass\n')
            (root/'tests/public').mkdir(parents=True)
            (root/'tests/public/test_probe.py').write_text(
                'import runpy\nfrom pathlib import Path\n'
                'runpy.run_path(str(Path(__file__).resolve().parents[2]/"starter/co_snark_drill.py"))\n')
            with patch.dict(os.environ, {'FLAG_SEED':'fixture-seed-must-not-escape'}):
                result=self.workbench(root,'fixture-seed-must-not-escape').run_public_tests({
                    'co_snark_drill.py':'import os\nprint("PROBE", os.environ.get("FLAG_SEED", "absent"))\n'})
            self.assertTrue(result['passed'], result['output'])
            self.assertIn('PROBE absent', result['output'])
            self.assertNotIn('fixture-seed-must-not-escape', result['output'])

    def test_prepare_and_verifier_keep_deployment_binding_without_sharing_seed(self):
        seed='binding-fixture'
        bench=self.workbench(ROOT,seed)
        answer=setting(seed)['expected']['csum']
        prepared=bench.prepare_submissions({'co_snark_drill.py':'pass'}, {'csum':str(answer)})
        envelope=prepared['submissions']['csum']
        with patch.object(server,'SEED',seed):
            unpacked=server._unwrap_submission('csum',envelope)
            self.assertTrue(server.evaluate('csum',unpacked))
            self.assertIsNone(server._unwrap_submission('shares',envelope))
            self.assertIsNone(server._unwrap_submission('csum',str(answer)))
        with patch.object(server,'SEED','another-deployment'):
            self.assertIsNone(server._unwrap_submission('csum',envelope))
        payload=server.public_payload(seed)
        self.assertNotIn(seed,json.dumps(payload))
        self.assertNotIn('expected',payload)
        self.assertEqual(payload['submissionBinding'],submission_binding(seed))


if __name__ == '__main__':
    unittest.main()
