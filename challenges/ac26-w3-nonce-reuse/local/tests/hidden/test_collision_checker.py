"""Regression tests for the checker, not participant tasks or fixtures."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('checker', Path(__file__).with_name('check_recover.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

class CollisionCheckerTest(unittest.TestCase):
    def test_zero_collisions_are_valid_when_measured(self):
        def distinct(seed, secret, message, group):
            self.assertEqual(secret, 1)
            return int(message.decode().split('-')[1])
        submission = SimpleNamespace(collision_experiment=lambda seed, group, n: {
            'distinct': n, 'collisions': 0, 'space': checker.NONCE_SPACE})
        with patch.object(checker, 'truncated_nonce', distinct):
            self.assertEqual(checker.check_collision(submission, 'zero-collision-test'), [])

    def test_plausible_but_fabricated_counts_are_rejected(self):
        submission = SimpleNamespace(collision_experiment=lambda seed, group, n: {
            'distinct': n-1, 'collisions': 1, 'space': checker.NONCE_SPACE})
        with patch.object(checker, 'truncated_nonce', return_value=1):
            self.assertTrue(checker.check_collision(submission, 'fabricated-test'))

    def test_reference_uses_the_documented_measurement(self):
        reference_path = Path(__file__).resolve().parents[2] / 'reference' / 'recover.py'
        refspec = importlib.util.spec_from_file_location('reference', reference_path)
        reference = importlib.util.module_from_spec(refspec)
        refspec.loader.exec_module(reference)
        self.assertEqual(checker.check_collision(reference, 'reproducible-test'), [])

if __name__ == '__main__':
    unittest.main()
