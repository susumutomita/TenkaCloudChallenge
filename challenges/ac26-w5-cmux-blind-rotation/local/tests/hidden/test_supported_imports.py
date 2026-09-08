"""Normal supported-library compatibility through the evaluator."""
from pathlib import Path
import unittest
from verifier import server

class ImportCompatibilityTests(unittest.TestCase):
    def test_supported_computation_imports(self):
        source = Path('reference/cmux.py').read_text() + '\nimport array, base64, binascii, bisect, collections, contextlib, copy, dataclasses, decimal, enum, fractions, functools, hashlib, heapq, hmac, itertools, json, math, operator, random, re, statistics, string, struct, time, typing\nassert array.array("i", [1, 2]).tolist() == [1, 2]\nassert string.ascii_lowercase[:3] == "abc"\n'
        for checkpoint in server.CODE_CHECKPOINTS:
            result = server.evaluate(checkpoint, source)
            self.assertTrue(result[0] if isinstance(result, tuple) else result, result)
