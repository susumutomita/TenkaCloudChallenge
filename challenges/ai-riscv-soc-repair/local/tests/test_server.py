from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.server import derive_flag, verification_verdict  # noqa: E402


class VerificationContractTest(unittest.TestCase):
    def test_should_derive_a_stable_seed_scoped_flag(self) -> None:
        with patch.dict(os.environ, {"FLAG_SEED": "alpha"}):
            first = derive_flag()
            second = derive_flag()
        with patch.dict(os.environ, {"FLAG_SEED": "beta"}):
            other = derive_flag()

        self.assertEqual(first, second)
        self.assertRegex(first, r"^TENKACLOUD\{rv32i_soc_booted_[0-9a-f]{16}\}$")
        self.assertNotEqual(first, other)

    def test_should_reject_the_right_flag_when_rtl_does_not_pass(self) -> None:
        verdict = verification_verdict("TENKACLOUD{expected}", False, "TENKACLOUD{expected}")
        self.assertFalse(verdict["correct"])

    def test_should_reject_a_fixed_or_foreign_flag_when_rtl_passes(self) -> None:
        verdict = verification_verdict("TENKACLOUD{fixed}", True, "TENKACLOUD{expected}")
        self.assertFalse(verdict["correct"])

    def test_should_accept_only_the_seed_flag_after_rtl_passes(self) -> None:
        verdict = verification_verdict(
            "TENKACLOUD{expected}", True, "TENKACLOUD{expected}"
        )
        self.assertTrue(verdict["correct"])


if __name__ == "__main__":
    unittest.main()
