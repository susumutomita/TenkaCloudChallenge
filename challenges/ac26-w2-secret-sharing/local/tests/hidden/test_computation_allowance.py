"""Exercise computational imports, real CPU time and verifier forwarding locally."""
import json, sys, time, unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest.mock import patch
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from participant import execution
from participant import server as workbench_server
from participant.isolation import protect_supervisor
MAX_COMPUTATION_SECONDS = 12

@unittest.skipUnless(sys.platform == 'linux', 'requires the deployed Linux worker')
class ComputationalAllowance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def invoke(self, source):
        result = execution.run_functions(source, [{'fn':'probe','args':[]}])
        return result['results'][0].get('value') if result and result.get('results') else None

    def test_documented_libraries_are_importable_inside_submission(self):
        source = """
import collections, decimal, fractions, functools, hashlib, hmac, itertools
import json, math, operator, random, statistics, time, typing
def probe():
    return sum([fractions.Fraction(2, 4).numerator,
            int(decimal.Decimal('2.5') * 2), statistics.median([1, 3, 2]),
            functools.reduce(operator.add, [1, 2]), len(hashlib.sha256(b'x').digest()),
            len(hmac.new(b'k', b'x', 'sha256').digest())])
"""
        self.assertEqual(self.invoke(source), 75)

    def test_six_cpu_seconds_fit_the_execution_deadline(self):
        source = """
import time
def probe():
    start = time.process_time()
    while time.process_time() - start < 6:
        pass
    return 7
"""
        self.assertEqual(self.invoke(source), 7)

if __name__ == '__main__':
    unittest.main()
