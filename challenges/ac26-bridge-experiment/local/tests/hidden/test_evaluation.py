"""Author regressions for the restricted function-value evaluation route."""
from pathlib import Path
import unittest
from unittest.mock import patch
from participant.execution import LearnerSession, LearnerError
from verifier import server
from participant.protocol import encode, decode

CHECKPOINTS = ('generalize', 'count-no-walkback')

class EvaluationTests(unittest.TestCase):
    def test_timeout_is_recorded_without_running_learner_code(self):
        session = LearnerSession({})
        session.deadline = 0
        with patch('participant.execution.time.monotonic', return_value=1):
            with self.assertRaises(LearnerError):
                session.call('counter', 'count_no_walkback', ())
        self.assertTrue(session.timed_out)

    def test_count_timeout_keeps_property_feedback_when_checker_catches_error(self):
        with patch.object(server, 'LearnerSession') as factory, patch.object(server.check_counter, 'run_count', return_value=['raised LearnerError on a valid input']):
            factory.return_value.timed_out = True
            correct, message = server.evaluate('count-no-walkback', 'pass')
        self.assertFalse(correct)
        self.assertIn('cannot be walked one number at a time', message)
        self.assertNotIn('LearnerError', message)

    def test_initialization_timeout_does_not_report_counting_failure(self):
        with patch.object(server, 'LearnerSession') as factory:
            factory.return_value.timed_out = True
            factory.return_value.__enter__.side_effect = LearnerError('timeout')
            correct, message = server.evaluate('count-no-walkback', 'pass')
        self.assertFalse(correct)
        self.assertIn('during initialization', message)
        self.assertNotIn('ranges', message)

    def test_supported_computation_imports(self):
        source = Path('reference/counter.py').read_text() + '\nimport array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing\nassert array.array("i", [1, 2]).tolist() == [1, 2]\nassert string.ascii_lowercase[:3] == "abc"\nassert time.strptime("2000-01-02", "%Y-%m-%d").tm_mday == 2\n'
        for checkpoint in CHECKPOINTS:
            result = server.evaluate(checkpoint, source)
            self.assertTrue(result[0] if isinstance(result, tuple) else result, result)

    def test_reference_through_evaluator(self):
        source = Path('reference/counter.py').read_text()
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                result = server.evaluate(checkpoint, source)
                self.assertTrue(result[0] if isinstance(result, tuple) else result, result)

    def test_missing_function_is_not_a_completed_answer(self):
        for checkpoint in CHECKPOINTS:
            with self.subTest(checkpoint=checkpoint):
                result = server.evaluate(checkpoint, 'pass')
                self.assertFalse(result[0] if isinstance(result, tuple) else result)

    def test_integer_subclass_answers(self):
        source = Path('reference/counter.py').read_text() + '\nclass AnswerInt(int): pass\n_base_advance = advance\n_base_count = count_no_walkback\ndef advance(*args): return [AnswerInt(x) for x in _base_advance(*args)]\ndef count_no_walkback(*args): return AnswerInt(_base_count(*args))\n'
        for checkpoint in CHECKPOINTS:
            result = server.evaluate(checkpoint, source)
            self.assertTrue(result[0] if isinstance(result, tuple) else result, result)

    def test_integer_subclass_value(self):
        class AnswerInt(int):
            pass
        self.assertEqual(decode(encode(AnswerInt(3))), 3)
        self.assertIs(type(decode(encode(True))), bool)

    def test_value_types_are_preserved(self):
        values = [b'abc', bytearray(b'abc'), (1, 2), [1, 2], True, 1, {1: (False, None)}]
        for value in values:
            actual = decode(encode(value))
            self.assertIs(type(actual), type(value))
            self.assertEqual(actual, value)

    def test_padding_bytearray_is_a_valid_alternative(self):
        if 'counter' != 'padding':
            return
        source = Path('reference/padding.py').read_text()
        source += '\n_original_pad = pad_message\ndef pad_message(message):\n    return bytearray(_original_pad(message))\n'
        self.assertTrue(server.evaluate('pad', source))

if __name__ == '__main__':
    unittest.main()
