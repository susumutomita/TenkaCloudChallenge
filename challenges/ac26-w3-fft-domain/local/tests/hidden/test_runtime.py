"""Exercise the actual private evaluator and public value boundary on Linux."""
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from verifier.server import evaluate, CHECKPOINTS
from participant.execution import LearnerSession, LearnerError
from participant.isolation import protect_supervisor
from tests.public.test_fftdomain import run_cases
protect_supervisor()
READER = (ROOT/'tests/hidden/reader-fftdomain.py').read_text()

class RuntimeTests(unittest.TestCase):
    def test_reader_passes_all_private_checkpoints(self):
        for name in CHECKPOINTS:
            with self.subTest(name=name):
                self.assertTrue(evaluate(name, READER))

    def test_reader_passes_actual_public_cases(self):
        with LearnerSession({'fftdomain.py': READER}) as session:
            failures, output = run_cases(session.module())
        self.assertEqual(failures, [], output)

    def test_printed_verdict_does_not_score(self):
        source = "print('{\"failures\":[]}')\nraise SystemExit\n"
        for name in CHECKPOINTS:
            self.assertFalse(evaluate(name, source))

    def test_starter_public_success_does_not_imply_private_success(self):
        source = (ROOT/'starter/fftdomain.py').read_text()
        with LearnerSession({'fftdomain.py': source}) as session:
            failures, output = run_cases(session.module())
        self.assertEqual(failures, [], output)
        self.assertFalse(evaluate('domain', source))

    def test_float_remainders_are_rejected(self):
        source = READER + "\n_original_fft=fft\ndef fft(*args):\n r=_original_fft(*args)\n if r.get('ok'): r['values']=[float(v) for v in r['values']]\n return r\n"
        self.assertFalse(evaluate('roundtrip', source))
        with LearnerSession({'fftdomain.py': source}) as session:
            failures, _ = run_cases(session.module())
        self.assertTrue(failures)

    def test_always_valid_and_wrong_values_do_not_score(self):
        source = READER + "\ndef validate_domain(*args): return {'ok':True,'valid':True}\n"
        self.assertFalse(evaluate('domain', source))
        source = READER + "\ndef fft(a,w,p): return {'ok':True,'values':[0]*len(a)}\n"
        self.assertFalse(evaluate('ordering', source))

    def test_learner_cannot_import_private_checker(self):
        source = 'from tests.hidden import check_fftdomain\n' + READER
        self.assertFalse(evaluate('generalize', source))

    def test_timeout_fails_and_next_session_recovers(self):
        with self.assertRaises(LearnerError):
            with LearnerSession({'fftdomain.py':'while True: pass'}, timeout=0.2):
                pass
        self.assertTrue(evaluate('domain', READER))

if __name__ == '__main__':
    unittest.main()
