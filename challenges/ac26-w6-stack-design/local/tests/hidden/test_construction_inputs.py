"""Author checks for comparing constructions against the original input."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reference = load('construction_reference', ROOT / 'reference' / 'stack.py')
checker = load('construction_checker', Path(__file__).with_name('check_stack.py'))


class ConstructionInputTest(unittest.TestCase):
    def test_in_place_counterexample_is_compared_to_the_original(self):
        def construct(built, prop):
            answer = reference.counterexample(built, prop)
            if answer is not built:
                built.clear()
                built.update(answer)
            return built
        self.assertEqual(checker._counterexample_failures(SimpleNamespace(counterexample=construct), 'in-place'), [])

    def test_in_place_repair_is_compared_to_the_original(self):
        def fix(built):
            answer = reference.repair(built)
            if answer is not built:
                built.clear()
                built.update(answer)
            return built
        self.assertEqual(checker._repair_failures(SimpleNamespace(repair=fix), 'in-place'), [])

    def test_changing_the_argument_does_not_relax_counterexample_policy(self):
        def construct(built, prop):
            built['policy']['maxCrossings'] += 1
            return reference.counterexample(built, prop)
        self.assertTrue(checker._counterexample_failures(SimpleNamespace(counterexample=construct), 'policy'))

    def test_changing_the_argument_does_not_relax_repair_policy(self):
        def fix(built):
            built['policy']['maxCrossings'] += 1
            return reference.repair(built)
        self.assertTrue(checker._repair_failures(SimpleNamespace(repair=fix), 'policy'))


if __name__ == '__main__':
    unittest.main()
