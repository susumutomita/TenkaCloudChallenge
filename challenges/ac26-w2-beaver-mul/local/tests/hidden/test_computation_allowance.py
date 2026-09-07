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
MAX_COMPUTATION_SECONDS = 20

@contextmanager
def delayed_verifier(delay, verdict):
    """A real loopback response, with no learner or external network involved."""
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            time.sleep(delay)
            body = json.dumps(verdict).encode()
            try:
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Expected when exercising the outbound timeout.

        def log_message(self, *_args):
            pass

    http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=http.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{http.server_port}/verify'
    finally:
        http.shutdown()
        http.server_close()
        thread.join()


class VerifierForwarding(unittest.TestCase):
    def test_suite_verdict_outlives_the_client_body_deadline(self):
        body = {'checkpointId': 'repair', 'submission': 'synthetic-test'}
        verdict = {'checkpointId': 'repair', 'correct': True}
        # Scale only this transport test. A real response arrives after the old
        # body-read timeout but before the separate outbound deadline.
        with delayed_verifier(.1, verdict) as url, \
                patch.object(workbench_server, 'REQUEST_TIMEOUT_SECONDS', .02), \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', 1, create=True):
            self.assertEqual(workbench_server.proxy_verdict(body, url), verdict)
        self.assertEqual(workbench_server.Handler.timeout, 15)
        self.assertEqual(workbench_server.RUN_TIMEOUT_SECONDS, 20)
        self.assertGreater(workbench_server.VERIFIER_TIMEOUT_SECONDS, MAX_COMPUTATION_SECONDS)

    def test_missing_or_mismatched_forwarded_verdict_still_fails_closed(self):
        body = {'checkpointId': 'repair', 'submission': 'synthetic-test'}
        failed = {'checkpointId': 'repair', 'correct': False}
        with delayed_verifier(.1, {'checkpointId': 'repair', 'correct': True}) as url, \
                patch.object(workbench_server, 'VERIFIER_TIMEOUT_SECONDS', .02, create=True):
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)
        with delayed_verifier(0, {'checkpointId': 'transfer', 'correct': True}) as url:
            self.assertEqual(workbench_server.proxy_verdict(body, url), failed)


@unittest.skipUnless(sys.platform == 'linux', 'requires the deployed Linux worker')
class ComputationalAllowance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        protect_supervisor()

    def invoke(self, source):
        with execution.LearnerSession({'beaver.py':source}, timeout=20) as learner:
            return learner.call('beaver','probe',[])

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
