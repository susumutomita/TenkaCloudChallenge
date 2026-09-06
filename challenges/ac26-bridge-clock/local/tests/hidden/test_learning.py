"""Regression tests for the public equations, non-unique answers and input boundary."""
import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fixtures.generate import GRADED, normalize_answer, setting, valid_reuse
from participant import server as participant
from verifier import server as verifier


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Learning(unittest.TestCase):
    def test_every_candidate_has_one_cover_on_prime_and_composite_clocks(self):
        for n in range(5,10):
            for observed in range(n):
                for candidate in range(n):
                    matches=[c for c in range(n) if (candidate+c)%n==observed]
                    self.assertEqual(matches,[(observed-candidate)%n])

    def test_all_alternative_originals_pass_but_the_actual_first_does_not(self):
        for n in range(5,10):
            for first in range(n):
                for seen1 in range(n):
                    for seen2 in range(n):
                        if seen1==seen2:continue
                        pub=dict(n=n,known_first=first,seen1=seen1,seen2=seen2)
                        for a in range(n):
                            r=(seen1-a)%n
                            b=(seen2-r)%n
                            self.assertEqual(valid_reuse(pub,[a,b,r]),a!=first)
                            self.assertEqual((a-b)%n,(seen1-seen2)%n)
                            self.assertFalse(valid_reuse(pub,[a,b,(r+1)%n]))

    def test_fixed_values_are_records_not_an_asserted_uniform_sampler(self):
        for i in range(60):
            case=setting('clock-record-'+str(i));pub=case['public'];n=pub['n']
            self.assertTrue(5<=n<=9)
            self.assertEqual(set(pub),{'n','u','v','secret','cover','known_first','seen1','seen2'})
            self.assertNotEqual(pub['seen1'],pub['seen2'])
            self.assertNotEqual(case['expected']['leak'],pub['known_first'])
            self.assertEqual((pub['known_first']-pub['seen1']+pub['seen2'])%n,case['expected']['leak'])

    def test_wrong_shapes_booleans_floats_and_noncanonical_constructions_fail(self):
        pub=dict(n=5,known_first=4,seen1=2,seen2=4)
        for bad in ([0,2],[0,2,2,0],[0.0,2,2],[False,2,2],[-5,2,2],[5,2,2],[4,1,3],[0,3,2]):
            self.assertFalse(valid_reuse(pub,bad),repr(bad))
        for checkpoint in GRADED:
            for bad in (True,False,1.1,'true','1.1','[1,,2]','[1,2,3,]','[true,2,3]'):
                self.assertIsNone(normalize_answer(checkpoint,bad),(checkpoint,bad))

    def test_public_function_outputs_copy_through_prepare_and_verify(self):
        reference=load(ROOT/'reference/clock_drill.py','clock_reference_test')
        public=load(ROOT/'tests/public/test_clock_drill.py','clock_public_test')
        with patch.object(public,'drill',reference):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertTrue(public.part1())
            for i in range(20):
                seed='clock-output-'+str(i)
                payload=verifier.public_payload(seed)
                output=io.StringIO()
                with patch.object(public,'public_evidence',return_value=payload),contextlib.redirect_stdout(output):
                    public.part2()
                raw={line.split('->',1)[0].strip():line.split('->',1)[1].strip()
                     for line in output.getvalue().splitlines() if '->' in line}
                self.assertEqual(set(raw),set(GRADED))
                with patch.object(verifier,'SEED',seed),patch.object(
                    participant._WORKBENCH,'sealing_key',__import__('hashlib').sha256((verifier.PROBLEM_ID+'\0'+seed).encode()).digest()):
                    prepared=participant._WORKBENCH.prepare_submissions(
                        {'clock_drill.py':(ROOT/'starter/clock_drill.py').read_text()},raw)
                    self.assertTrue(prepared['ok'])
                    for checkpoint,token in prepared['submissions'].items():
                        answer=verifier._unwrap_submission(checkpoint,token)
                        self.assertTrue(verifier.evaluate(checkpoint,answer),checkpoint)

    def test_oversized_integer_fails_without_crashing_prepare_or_verification(self):
        huge='9'*5000
        self.assertEqual(participant._WORKBENCH._decode_manual(huge),huge)
        for name in GRADED:
            self.assertFalse(verifier.evaluate(name,huge))


if __name__=='__main__':unittest.main()
