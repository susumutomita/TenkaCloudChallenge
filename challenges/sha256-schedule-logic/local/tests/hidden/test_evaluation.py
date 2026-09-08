"""Author regressions for the restricted function-value evaluation route."""
from pathlib import Path
import unittest
from verifier import server
from participant.protocol import encode, decode

CHECKPOINTS = server.CODE_CHECKPOINTS

class EvaluationTests(unittest.TestCase):
    def test_supported_computation_imports(self):
        source = Path('reference/schedule.py').read_text() + '\nimport array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing\nassert array.array("i", [1, 2]).tolist() == [1, 2]\nassert string.ascii_lowercase[:3] == "abc"\n'
        for checkpoint in CHECKPOINTS:
            result = server.evaluate(checkpoint, source)
            self.assertTrue(result[0] if isinstance(result, tuple) else result, result)

    def test_reference_through_evaluator(self):
        source = Path('reference/schedule.py').read_text()
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                result = server.evaluate(checkpoint, source)
                self.assertTrue(result[0] if isinstance(result, tuple) else result, result)

    def test_missing_function_is_not_a_completed_answer(self):
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                result = server.evaluate(checkpoint, 'pass')
                self.assertFalse(result[0] if isinstance(result, tuple) else result)

    def test_value_types_are_preserved(self):
        values = [b'abc', bytearray(b'abc'), (1, 2), [1, 2], True, 1, {1: (False, None)}]
        for value in values:
            actual = decode(encode(value))
            self.assertIs(type(actual), type(value))
            self.assertEqual(actual, value)

    def test_padding_bytearray_is_a_valid_alternative(self):
        if 'schedule' != 'padding':
            return
        source = Path('reference/padding.py').read_text()
        source += '\n_original_pad = pad_message\ndef pad_message(message):\n    return bytearray(_original_pad(message))\n'
        self.assertTrue(server.evaluate('pad', source))

if __name__ == '__main__':
    unittest.main()
