from __future__ import annotations

from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.server import verification_verdict  # noqa: E402


class VerificationContractTest(unittest.TestCase):
    def test_should_reject_verify_when_runtime_assertions_fail(self) -> None:
        verdict = verification_verdict("VERIFY", False, True)
        self.assertFalse(verdict["correct"])

    def test_should_reject_verify_when_frame_digest_does_not_match(self) -> None:
        verdict = verification_verdict("VERIFY", True, False)
        self.assertFalse(verdict["correct"])

    def test_should_reject_a_source_signature_or_foreign_submission(self) -> None:
        verdict = verification_verdict("CDC_SYNC_STAGES=2", True, True)
        self.assertFalse(verdict["correct"])

    def test_should_accept_only_verify_after_state_and_artifact_pass(self) -> None:
        verdict = verification_verdict("  VERIFY  ", True, True)
        self.assertTrue(verdict["correct"])


if __name__ == "__main__":
    unittest.main()
