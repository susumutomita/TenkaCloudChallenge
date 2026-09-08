"""Normal and malformed supplied-protocol argument contracts."""
import unittest
from participant.execution import valid_callback_arguments
from participant.lab import tiny_settings

class CallbackContractTests(unittest.TestCase):
    def test_documented_tiny_runs(self):
        for setting in tiny_settings():
            self.assertTrue(valid_callback_arguments((setting, (0,) * setting.randomness_length)))

    def test_missing_or_mismatched_arguments(self):
        self.assertFalse(valid_callback_arguments(()))
        self.assertFalse(valid_callback_arguments((tiny_settings()[0], ())))
        self.assertFalse(valid_callback_arguments((None, ())))
