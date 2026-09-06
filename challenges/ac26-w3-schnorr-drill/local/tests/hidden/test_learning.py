"""Author-only learning regressions; not included in the participant image."""
import json
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fixtures.generate import TOY_GROUPS, ec_add, order_of, public_payload, setting, normalize_answer
from verifier.expected import valid_construction, expected_for
# Independently hand-calculated from the supplied slope and reflection formulas.
TABLES={(5,2,1):[None,(0,1),(1,3),(3,3),(3,2),(1,2),(0,4)],(7,1,1):[None,(0,1),(2,5),(2,2),(0,6)]}
class LearningContract(unittest.TestCase):
    def test_tiny_curves_match_independent_tables(self):
        for p,a,b,gx,gy,n in TOY_GROUPS:
            table=TABLES[p,a,b]
            self.assertEqual(len(table),n)
            for i,P in enumerate(table):
                if P is not None:self.assertEqual((P[1]**2-P[0]**3-a*P[0]-b)%p,0)
                for j,Q in enumerate(table):self.assertEqual(ec_add(P,Q,p,a),table[(i+j)%n])
            self.assertEqual(order_of((gx,gy),p,a),n)
            self.assertLessEqual(n,7);self.assertNotEqual(p,n)
    def test_public_inputs_exclude_hidden_material(self):
        seen=set()
        for i in range(80):
            payload=public_payload(f'learning-{i}');pub=payload['public'];seen.add((pub['p'],pub['a'],pub['b']))
            self.assertEqual(set(pub),{'p','a','b','G','Gx','Gy','t','Q','Qx','Qy','x','r','e','P1','e1','s1','e2','s2','P2','ef'})
            self.assertEqual(set(payload),{'public','pointKeys','assignments','lines'})
            self.assertNotEqual(pub['Gx'],pub['Qx']);self.assertNotEqual(pub['e1'],pub['e2'])
            self.assertNotEqual(pub['P2'],pub['P1'])
            self.assertNotEqual(pub['P2'],TABLES[pub['p'],pub['a'],pub['b']][pub['x']])
        self.assertEqual(seen,set(TABLES))
    def test_every_final_record_against_independent_group_table(self):
        for i in range(20):
            pub=setting(f'construction-{i}')['public'];p=pub['p'];table=TABLES[p,pub['a'],pub['b']];n=len(table);key=table.index(pub['P2']);accepted=0
            for rx in range(p):
                for ry in range(p):
                    for s in range(n):
                        expected=table[(s-pub['ef']*key)%n]==(rx,ry)
                        self.assertEqual(valid_construction(pub,[rx,ry,s]),expected);accepted+=int(expected)
            self.assertEqual(accepted,n-1)
    def test_changed_challenge_rejects_same_record(self):
        for i in range(30):
            seed=f'timing-{i}';pub=setting(seed)['public'];record=expected_for(seed)['transfer'];n=len(TABLES[pub['p'],pub['a'],pub['b']])
            self.assertTrue(valid_construction(pub,record))
            self.assertFalse(valid_construction({**pub,'ef':(pub['ef']+1)%n},record))
    def test_final_shape_and_canonical_numbers(self):
        pub=setting('shape')['public'];r=expected_for('shape')['transfer'];p=pub['p']
        for raw in (True,None,1,{},[],list(r)+[0],[True,r[1],r[2]],list(map(float,r)),[r[0]+p,r[1],r[2]],[-1,r[1],r[2]],[r[0],r[1],99],'not-json'):
            self.assertFalse(valid_construction(pub,raw),repr(raw))
        self.assertTrue(valid_construction(pub,json.dumps(r)))
    def test_points_do_not_coerce_boolean_or_fractional_coordinates(self):
        for value in ([True,1],[0,False],[0.9,1],[0,1.9]):
            self.assertIsNone(normalize_answer('double',value))
        self.assertEqual(normalize_answer('double','[0, 1]'),(0,1))
    def test_response_and_reuse_relation_for_varied_instances(self):
        for i in range(100):
            seed=f'parameters-{i}';pub=setting(seed)['public'];exp=expected_for(seed);table=TABLES[pub['p'],pub['a'],pub['b']];n=len(table)
            self.assertEqual(exp['order'],n);self.assertEqual(pub['t']*exp['field-inv']%pub['p'],1)
            self.assertEqual(table[exp['response']],exp['verify']);self.assertEqual(table[exp['nonce-reuse']],pub['P1'])
            self.assertEqual((pub['s1']-pub['s2'])%n,(pub['e1']-pub['e2'])*exp['nonce-reuse']%n)
    def test_participant_stage_contains_no_answer_source(self):
        path=ROOT/'Dockerfile'
        stage=path.read_text().split('FROM base AS participant')[1].split('FROM base AS verifier')[0]
        for source in ('fixtures/','verifier/','tests/hidden/','reference/'):
            self.assertNotIn('COPY --chown=lab:lab '+source,stage)
if __name__=='__main__':unittest.main()
