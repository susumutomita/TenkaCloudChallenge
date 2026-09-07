"""The real grader accepts exact integers, never rounded tuple entries."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fixtures.generate import normalize_answer, setting
from verifier import server


class AnswerShapes(unittest.TestCase):
    def test_fractional_tuple_cannot_be_truncated_into_a_correct_answer(self):
        with patch.object(server, 'SEED', 'shape-regression'):
            expected = setting(server.SEED)['expected']
            for checkpoint in ('covered', 'held', 'product'):
                value = expected[checkpoint]
                for index in range(len(value)):
                    fractional = list(value)
                    fractional[index] += 0.9
                    self.assertFalse(server.evaluate(checkpoint, fractional))
                self.assertTrue(server.evaluate(checkpoint, list(value)))
                self.assertTrue(server.evaluate(checkpoint, ', '.join(map(str, value))))
                self.assertTrue(server.evaluate(checkpoint, str(tuple(value))))

    def test_tuple_booleans_and_non_integer_objects_are_rejected(self):
        for value in ([True, 2], [1.0, 2], [None, 2], [[], 2], [float('inf'), 2]):
            self.assertIsNone(normalize_answer('covered', value))
        self.assertEqual(normalize_answer('covered', ['+1', '-2']), (1, -2))

    def test_scalar_and_tuple_shapes_remain_distinct(self):
        for value in ([1, 2], 1.5, True):
            self.assertFalse(server.evaluate('sum-covered', value))
        for value in (1, [1], [1, 2, 3], '1.5,2'):
            self.assertFalse(server.evaluate('covered', value))


if __name__ == '__main__':
    unittest.main()
