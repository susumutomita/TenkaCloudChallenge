"""Author-only single-checkpoint regressions for compatibility and transfer."""
from pathlib import Path
import sys
import types
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.hidden import check_extract as checker
SOURCE=(ROOT/'reference/extract.py').read_text()
def load(source=SOURCE):
    obj=types.ModuleType('solution');exec(compile(source,'solution','exec'),obj.__dict__);return obj
class CompatibilityTests(unittest.TestCase):
    def test_reference_including_absent_and_none_key_id(self):
        obj=load()
        self.assertEqual(checker.check_switch(obj,'contract'),[])
        self.assertEqual(checker.check_domains(obj,'contract'),[])
        self.assertEqual(checker.check_counterexample(obj,'contract'),[])
    def test_interior_index_fault_rejected_at_counterexample(self):
        obj=load(SOURCE.replace('secret[index + 1] = 1','secret[0 if degree >= 4 and index == 1 else index + 1] = 1'))
        self.assertTrue(checker.check_counterexample(obj,'contract'))
    def test_every_trace_index_is_checked(self):
        obj=load(); original=obj.extract_trace
        def incomplete(params, ciphertext, index):
            return [] if params['degree'] >= 4 and index == 1 else original(params, ciphertext, index)
        obj.extract_trace=incomplete
        self.assertTrue(checker.check_trace(obj,'contract'))
        self.assertTrue(checker.check_transfer(obj,'contract'))
    def test_directional_comparisons_rejected_at_both_checkpoints(self):
        for field,other in [('sourceDimension','len(sample["mask"])'),('modulus','params["modulus"]'),('base','params["base"]'),('levels','params["levels"]')]:
            for op in ('<','>'):
                with self.subTest(field=field,op=op):
                    old=f'switching_key["{field}"] != {other}'
                    self.assertIn(old,SOURCE)
                    obj=load(SOURCE.replace(old,f'switching_key["{field}"] {op} {other}'))
                    self.assertTrue(checker.check_switch(obj,'contract'))
                    self.assertTrue(checker.check_domains(obj,'contract'))
if __name__=='__main__':unittest.main()
