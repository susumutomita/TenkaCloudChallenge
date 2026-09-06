"""Public mathematics, acceptance of constructions, and participant submission contract."""
import contextlib,io,json,os,runpy,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
METADATA=json.load(sys.stdin) if os.environ.get('READ_METADATA_STDIN')=='1' else json.loads((ROOT.parent/'metadata.json').read_text())
from fixtures.generate import GRADED,normalize_answer,setting
from verifier import server
from verifier.expected import expected_for,valid_construction
from participant.exercise import EXAMPLE,EXAMPLE_EXPECTED,call_row,construction_valid
from participant.model import table,addresses,fingerprints,products,inverse
from participant.workbench import PortalEditorSupport
from reference import plonk_drill as reference
from tests.hidden.check_plonk_drill import run

def workspace(seed):
    fixture=server.public_payload(seed)
    return PortalEditorSupport(root=ROOT,deployment_binding=fixture['submissionBinding'],
       public_payload={k:fixture[k] for k in ('assignments','public')},problem_id='ac26-w4-plonk-drill',
       problem_name=METADATA['name'],description=METADATA['shortDescription'],submitted_files=('plonk_drill.py',),
       code_checkpoints=(),checkpoints=GRADED,checkpoint_labels={c['id']:c['label'] for c in METADATA['scoring']['checks']},
       max_body_bytes=262144,run_timeout_seconds=20,max_output_bytes=65536,limit_fn=lambda:None)

class LearningContract(unittest.TestCase):
    def test_visible_examples(self):
        for row in GRADED:
            got=normalize_answer(row,call_row(reference,row,EXAMPLE))
            if row=='miss-count':self.assertTrue(construction_valid(got,EXAMPLE))
            else:self.assertEqual(got,EXAMPLE_EXPECTED[row])

    def test_generated_conditions_and_address_permutations(self):
        tags_seen=set();answers={row:set() for row in GRADED}
        for i in range(150):
            seed=f'coverage-{i}';v=setting(seed)['public'];p=v['p'];self.assertEqual(p,7)
            self.assertTrue(all(0<=n<p for k,n in v.items() if k!='p'))
            tags=tuple(v[k] for k in ('k0','k1','k2'));tags_seen.add(tags)
            a=addresses(tags,v['w'],p);self.assertEqual(set(a),set(range(1,p)))
            self.assertEqual(v['w']**2%p,1);self.assertNotEqual(v['w'],1)
            self.assertEqual(run(reference,seed),[])
            expected=expected_for(seed)
            self.assertEqual(*expected['grand-product']);self.assertNotEqual(expected['grand-product'][0],0)
            self.assertNotEqual(*expected['bad-product']);self.assertTrue(all(expected['bad-product']))
            for row in GRADED:answers[row].add(tuple(call_row(reference,row,v)))
        self.assertEqual(len(tags_seen),6)
        self.assertTrue(all(len(results)>1 for results in answers.values()))

    def test_every_construction_matches_both_grading_paths_and_linear_equation(self):
        count=0;zero_rejections=0
        for i in range(30):
            seed=f'construction-{i}';v=setting(seed)['public'];p=v['p'];rows=table(v['a0'],v['b0'],p);u=rows[0][2]
            tags=tuple(v[k] for k in ('k0','k1','k2'));addr=addresses(tags,v['w'],p)
            a,b,c=[(v['beta']*addr[j]+v['gamma'])%p for j in (2,3,4)]
            linear=set();brute=set()
            for l in range(p):
                if l==u:continue
                T=(u+a)*(l+b)%p;U=(u+b)*(l+c)%p
                if (T-U)%p:
                    r=(U*a-T*c)*inverse(T-U,p)%p
                    candidate=(l,r,l*r%p)
                    if construction_valid(candidate,v):linear.add(candidate)
            for l in range(p):
                for r in range(p):
                    candidate=(l,r,l*r%p)
                    public=construction_valid(candidate,v);private=valid_construction(seed,candidate)
                    self.assertEqual(public,private)
                    if public:brute.add(candidate);count+=1
                    pair=products((rows[0],candidate),tags,v['w'],p,v['beta'],v['gamma'])
                    if l!=u and r!=u and pair==(0,0):
                        zero_rejections+=1;self.assertFalse(private)
                    if public:
                        with patch.object(server,'SEED',seed):self.assertTrue(server.evaluate('miss-count',candidate))
            self.assertTrue(brute);self.assertEqual(linear,brute)
            self.assertFalse(valid_construction(seed,rows[1]))
        self.assertGreater(count,30);self.assertGreater(zero_rejections,0)

    def test_interpolation_gate_divisibility_and_accumulator_boundaries(self):
        # Check the abstract section against BOTH row positions on actual tables.
        for i in range(30):
            v=setting(f'polynomial-{i}')['public'];p=v['p'];rows=table(v['a0'],v['b0'],p)
            for col in range(3):
                A=(rows[0][col]+rows[1][col])*4%p;B=(rows[0][col]-rows[1][col])*4%p
                self.assertEqual((A+B)%p,rows[0][col]);self.assertEqual((A+B*6)%p,rows[1][col])
            self.assertEqual((rows[0][0]+rows[0][1]-rows[0][2])%p,0)
            self.assertEqual((rows[1][0]*rows[1][1]-rows[1][2])%p,0)
            tags=tuple(v[k] for k in ('k0','k1','k2'))
            for current,closes in [(rows,True),((rows[0],call_row(reference,'bad-row',v)),False)]:
                f,g=fingerprints(current,tags,v['w'],p,v['beta'],v['gamma']);z=1
                for start in (0,3):
                    F=G=1
                    for j in range(start,start+3):F=F*f[j]%p;G=G*g[j]%p
                    self.assertNotEqual(G,0);z=z*F*inverse(G,p)%p
                self.assertEqual(z==1,closes)

    def test_partial_prepare_and_cross_deployment_rejection(self):
        seed='current-plonk';work=workspace(seed);other=workspace('other-plonk')
        files={'plonk_drill.py':(ROOT/'starter/plonk_drill.py').read_text()}
        answer=str(expected_for(seed)['outputs']);prepared=work.prepare_submissions(files,{'outputs':answer})
        self.assertTrue(prepared['ok']);self.assertEqual(set(prepared['submissions']),{'outputs'});self.assertEqual(len(prepared['missingManual']),7)
        with patch.object(server,'SEED',seed):
            token=prepared['submissions']['outputs'];self.assertTrue(server.evaluate('outputs',server._unwrap_submission('outputs',token)))
            self.assertIsNone(server._unwrap_submission('bad-row',token));self.assertIsNone(server._unwrap_submission('outputs',answer))
            old=other.prepare_submissions(files,{'outputs':answer})['submissions']['outputs']
            self.assertIsNone(server._unwrap_submission('outputs',old))

    def test_inspect_contains_public_assignments_only(self):
        seed='inspect-plonk';payload=server.public_payload(seed);output=workspace(seed).inspect_payload()
        self.assertEqual(set(payload),{'public','assignments','submissionBinding'})
        self.assertIn(payload['assignments'],output['output']);self.assertNotIn('submissionBinding',json.dumps(output));self.assertNotIn('Traceback',output['output'])

    def test_first_optional_edit_from_the_actual_instructions(self):
        first='return ((a0+b0)%p, ((a0+b0)%p)**2%p)'
        for text in (METADATA['instructions'],METADATA['i18n']['en']['instructions']):self.assertIn(first,text)
        source=(ROOT/'starter/plonk_drill.py').read_text().replace('    return None','    '+first,1)
        module=types.ModuleType('plonk_drill');exec(compile(source,'<participant first action>','exec'),module.__dict__)
        output=io.StringIO()
        with patch.dict(sys.modules,{'plonk_drill':module}),patch.dict(os.environ,{'PUBLIC_EVIDENCE_JSON':json.dumps(server.public_payload('first-plonk'))}),patch.object(sys,'argv',['test_plonk_drill.py','--only','outputs']),contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as end:runpy.run_path(str(ROOT/'tests/public/test_plonk_drill.py'),run_name='__main__')
        self.assertEqual(end.exception.code,0,output.getvalue());self.assertIn('PASS outputs',output.getvalue())

    def test_eight_fields_three_rungs_and_bilingual_scoring(self):
        ja=METADATA['scoring']['checks'];en=METADATA['i18n']['en']['checks']
        self.assertEqual([c['id'] for c in ja],list(GRADED));self.assertEqual([c['id'] for c in en],list(GRADED))
        self.assertEqual(sum(c['points'] for c in ja),200);self.assertEqual(sum(h['penalty'] for c in ja for h in c['hints']),48)
        for a,b in zip(ja,en):self.assertEqual(len(a['hints']),3);self.assertEqual([h['id'] for h in a['hints']],[h['id'] for h in b['hints']])

if __name__=='__main__':unittest.main()
