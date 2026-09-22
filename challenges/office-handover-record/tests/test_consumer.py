"""The shared family suite exercises this consumer's deployed handler too."""
import json
import runpy
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class ConsumerTest(unittest.TestCase):
    def test_problem_uses_shared_runtime_and_declares_one_final_flag(self):
        builder=runpy.run_path(str(ROOT/'build.py'))
        template=builder['template']()
        curriculum=json.loads((ROOT/'workshop.json').read_text())
        metadata=json.loads((ROOT/'metadata.json').read_text())
        self.assertEqual(curriculum['id'],metadata['id'])
        self.assertEqual(metadata['scoring'],{'kind':'flag','flagOutputKey':'CompletionFlag','points':100,'wrongAnswerPenalty':5})
        namespace={}
        exec(compile(template['Resources']['Workshop']['Properties']['Code']['ZipFile'],'index.py','exec'),namespace)
        self.assertEqual(namespace['CURRICULUM'],curriculum)
        self.assertEqual(template['Outputs']['CompletionFlag']['Value'],{'Fn::Sub':'TC{${CompletionSecret}}'})
if __name__=='__main__': unittest.main()
