"""Public tests: examples and function contracts, not the grading suite."""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _public_payload() -> dict:
    """The worked example these tests assert against, and how it is reached.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile) -- it defines `signed_message` under the exact
    name the starter asks the learner to write, and labels every assertion by kind for
    any seed. The verifier serves the public half over `GET /public` instead:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, `VERIFIER_PUBLIC_URL`
    when this process must fetch it itself, and a checkout-only `fixtures` fallback that
    never resolves inside a built `participant` image.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public worked example lives there since Issue 543 option B2. "
                "Start it with `make verifier-up` and try again."
            ) from error
    from fixtures.generate import public_payload

    return public_payload(os.environ.get("FLAG_SEED", "local-dev-seed"))


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
#: The worked example, not this deployment: these are teaching examples, so their
#: expected answers may be known. What a deployment serves is a different seed, and
#: `make inspect` is where to read it.
EXAMPLE = _public_payload()["workedExample"]
RECORD = EXAMPLE["serverRecord"]
ASSERTIONS = EXAMPLE["assertions"]
ALIASES_BY_KIND = EXAMPLE["aliasesByKind"]
BY_KIND = {
    kind: next(item for item in ASSERTIONS if item["caseId"] == alias)
    for kind, alias in ALIASES_BY_KIND.items()
}


def test_server_record_has_no_credential_secret() -> None:
    forbidden = ("private", "secret", "password")
    flattened = " ".join(str(key).lower() for key in RECORD)
    assert not any(word in flattened for word in forbidden)
    assert set(RECORD) == {
        "credentialId", "publicKey", "rpId", "expectedOrigin", "expectedChallenge"
    }
    assert all(assertion["id"] == RECORD["credentialId"] for assertion in ASSERTIONS)


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
    found = MODULE.find_signed_without_user_verification(RECORD, list(ASSERTIONS))
    assert found == ALIASES_BY_KIND["no-uv"]


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
