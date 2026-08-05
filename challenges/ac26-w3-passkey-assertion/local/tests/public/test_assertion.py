"""Public tests: examples and function contracts, not the grading suite."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fixtures.generate import b64url_decode, fixture


def _load_submission():
    directory = Path(os.environ.get("SUBMISSION_DIR", ROOT / "starter"))
    path = directory / "assertion.py"
    spec = importlib.util.spec_from_file_location("participant_assertion", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("assertion.py could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = _load_submission()
CASE = fixture("public-worked-example")
RECORD = CASE.server_record
BY_KIND = {
    kind: next(item for item in CASE.assertions if item["caseId"] == alias)
    for kind, alias in CASE.aliases_by_kind.items()
}


def test_server_record_has_no_credential_secret() -> None:
    forbidden = ("private", "secret", "password")
    flattened = " ".join(str(key).lower() for key in RECORD)
    assert not any(word in flattened for word in forbidden)
    assert set(RECORD) == {
        "credentialId", "publicKey", "rpId", "expectedOrigin", "expectedChallenge"
    }
    assert all(assertion["id"] == RECORD["credentialId"] for assertion in CASE.assertions)


def test_signed_message_is_authenticator_data_then_client_hash() -> None:
    assertion = BY_KIND["honest"]
    auth_data = b64url_decode(str(assertion["authenticatorData"]))
    client_data = b64url_decode(str(assertion["clientDataJSON"]))
    expected = auth_data + hashlib.sha256(client_data).digest()
    assert MODULE.signed_message(assertion) == expected


def test_signature_accepts_honest_and_rejects_tampering() -> None:
    public_key = RECORD["publicKey"]
    assert MODULE.verify_signature(public_key, BY_KIND["honest"]) is True
    assert MODULE.verify_signature(public_key, BY_KIND["bad-signature"]) is False


def test_user_verified_reads_the_uv_bit() -> None:
    assert MODULE.user_verified(BY_KIND["honest"]) is True
    assert MODULE.user_verified(BY_KIND["no-uv"]) is False


def test_finds_the_signed_assertion_without_uv() -> None:
    found = MODULE.find_signed_without_user_verification(RECORD, list(CASE.assertions))
    assert found == CASE.aliases_by_kind["no-uv"]


def test_uv_policy_changes_the_verdict_without_changing_the_signature() -> None:
    no_uv = BY_KIND["no-uv"]
    assert MODULE.verify_signature(RECORD["publicKey"], no_uv) is True
    assert MODULE.verify_assertion(RECORD, no_uv, False) == {"ok": True, "reason": "ok"}
    assert MODULE.verify_assertion(RECORD, no_uv, True) == {
        "ok": False,
        "reason": "user-verification-required",
    }


TESTS = [
    test_server_record_has_no_credential_secret,
    test_signed_message_is_authenticator_data_then_client_hash,
    test_signature_accepts_honest_and_rejects_tampering,
    test_user_verified_reads_the_uv_bit,
    test_finds_the_signed_assertion_without_uv,
    test_uv_policy_changes_the_verdict_without_changing_the_signature,
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    selected = [test for test in TESTS if args.only.lower() in test.__name__.lower()]
    if not selected:
        print(f"No public test contains {args.only!r}")
        return 1
    failures = 0
    for test in selected:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as error:  # noqa: BLE001 - test runner prints learner-friendly failures
            failures += 1
            print(f"FAIL {test.__name__}: {type(error).__name__}: {error}")
    print(f"\n{len(selected) - failures}/{len(selected)} public tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
