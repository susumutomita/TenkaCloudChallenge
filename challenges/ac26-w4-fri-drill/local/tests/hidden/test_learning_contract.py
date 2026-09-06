"""Problem-specific arithmetic, participant route and cross-deployment boundaries."""
from __future__ import annotations
import ast,contextlib,io,json,os,runpy,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
METADATA=json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN')=='1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED,normalize_answer,setting,submission_binding
from verifier.expected import expected_for
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row
from participant.workbench import PortalEditorSupport
from reference import fri_drill as reference
from verifier import server
from tests.hidden.check_fri_drill import run


def workspace(seed):
    fixture=server.public_payload(seed)
    return PortalEditorSupport(root=ROOT,deployment_binding=fixture['submissionBinding'],
       public_payload={key:fixture[key] for key in ('assignments','public')},
       problem_id='ac26-w4-fri-drill',problem_name=METADATA['name'],
       description=METADATA['shortDescription'],submitted_files=('fri_drill.py',),
       code_checkpoints=(),checkpoints=GRADED,checkpoint_labels={c['id']:c['label'] for c in METADATA['scoring']['checks']},
       max_body_bytes=262144,run_timeout_seconds=20,max_output_bytes=65536,limit_fn=lambda:None)


class LearningContract(unittest.TestCase):
    def test_all_visible_examples_match_the_implemented_formulas(self):
        for row in GRADED:
            self.assertEqual(normalize_answer(row,call_row(reference,row,EXAMPLE)),EXAMPLE_EXPECTED[row])

    def test_small_divisors_and_every_answer_vary(self):
        seen={row:set() for row in GRADED};primes=set()
        for i in range(80):
            seed=f'coverage-{i}';v=setting(seed)['public'];p=v['p'];primes.add(p)
            self.assertTrue(all(0<=n<p for key,n in v.items() if key!='p'))
            self.assertEqual(run(reference,seed),[])
            answers=expected_for(seed)
            self.assertNotEqual(answers['cheat-caught'][0],answers['cheat-caught'][1])
            self.assertEqual(len(answers['miss-points']),2)
            self.assertEqual(sum(answers['miss-points']),p)
            for row in GRADED:seen[row].add(answers[row])
        self.assertEqual(primes,{5,7})
        self.assertTrue(all(len(values)>1 for values in seen.values()),seen)

    def test_recovery_and_honest_first_fold_hold_at_every_nonzero_position(self):
        for i in range(40):
            v=setting(f'identities-{i}')['public'];p=v['p'];qs=tuple(v[k] for k in ('q0','q1','q2','q3'))
            for t in range(1,p):
                e,o,direct_e,direct_o=reference.recover(qs,t,p)
                self.assertEqual((e,o),(direct_e,direct_o))
                left,right=reference.consistency(qs,v['beta'],t,p)
                self.assertEqual(left,right)
                a,b=reference.cheat_caught(qs,v['beta'],t,v['d0'],v['d1'],p)
                self.assertEqual(a==b,t in expected_for(f'identities-{i}')['miss-points'])

    def test_inverse_definition_without_fermat_or_float_division(self):
        from participant.model import inverse
        for p in (5,7):
            for n in range(1,p):self.assertEqual(n*inverse(n,p)%p,1)
            with self.assertRaises(ValueError):inverse(0,p)

    def test_deployment_binding_and_partial_submission(self):
        seed='current-fri';work=workspace(seed);old=workspace('other-fri')
        files={'fri_drill.py':(ROOT/'starter/fri_drill.py').read_text()}
        answer=str(expected_for(seed)['poly'])
        prepared=work.prepare_submissions(files,{'poly':answer})
        self.assertTrue(prepared['ok']);self.assertEqual(set(prepared['submissions']),{'poly'})
        self.assertEqual(len(prepared['missingManual']),7)
        with patch.object(server,'SEED',seed):
            token=prepared['submissions']['poly']
            unwrapped=server._unwrap_submission('poly',token)
            self.assertTrue(server.evaluate('poly',unwrapped))
            self.assertIsNone(server._unwrap_submission('fold',token))
            self.assertIsNone(server._unwrap_submission('poly',answer))
            old_token=old.prepare_submissions(files,{'poly':answer})['submissions']['poly']
            self.assertIsNone(server._unwrap_submission('poly',old_token))

    def test_inspect_only_delivers_public_numbers(self):
        seed='inspect-fri';work=workspace(seed);payload=server.public_payload(seed)
        self.assertEqual(set(payload),{'public','assignments','submissionBinding'})
        inspect=work.inspect_payload()
        self.assertIn(payload['assignments'],inspect['output'])
        self.assertNotIn('submissionBinding',json.dumps(inspect))
        self.assertNotIn('Traceback',inspect['output'])

    def test_optional_first_function_from_both_statements(self):
        first='return (q(qs,0,p), q(qs,1,p), q(qs,2,p))'
        source=(ROOT/'starter/fri_drill.py').read_text().replace('    return None','    '+first,1)
        for text in (METADATA['instructions'],METADATA['i18n']['en']['instructions']):
            self.assertIn(first,text)
        learner=types.ModuleType('fri_drill');exec(compile(source,'<participant first action>','exec'),learner.__dict__)
        output=io.StringIO()
        with patch.dict(sys.modules,{'fri_drill':learner}),patch.dict(os.environ,{'PUBLIC_EVIDENCE_JSON':json.dumps(server.public_payload('visible-fri'))}),patch.object(sys,'argv',['test_fri_drill.py','--only','poly']),contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as end:runpy.run_path(str(ROOT/'tests/public/test_fri_drill.py'),run_name='__main__')
        self.assertEqual(end.exception.code,0,output.getvalue())
        self.assertIn('PASS poly',output.getvalue())
        self.assertIn('poly ->',output.getvalue())

    def test_eight_rows_and_bilingual_hint_cost(self):
        checks=METADATA['scoring']['checks'];english=METADATA['i18n']['en']['checks']
        self.assertEqual([c['id'] for c in checks],list(GRADED))
        self.assertEqual([c['id'] for c in english],list(GRADED))
        self.assertEqual(sum(c['points'] for c in checks),200)
        self.assertEqual(sum(h['penalty'] for c in checks for h in c['hints']),48)
        for ja,en in zip(checks,english):
            self.assertEqual(len(ja['hints']),3)
            self.assertEqual([h['id'] for h in ja['hints']],[h['id'] for h in en['hints']])


if __name__=='__main__':unittest.main()
