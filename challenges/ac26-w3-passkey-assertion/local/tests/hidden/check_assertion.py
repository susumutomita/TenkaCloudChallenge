"""Hidden properties for each independently scored checkpoint."""

from __future__ import annotations

import copy
import hashlib
from types import ModuleType

from fixtures.generate import b64url_decode, fixture

CHECKPOINTS = ("signature", "find-uv-gap", "enforce-uv")


def _by_kind(case):
    return {
        kind: next(item for item in case.assertions if item["caseId"] == alias)
        for kind, alias in case.aliases_by_kind.items()
    }


def _signature_failures(module: ModuleType, seeds: list[str]) -> list[str]:
    failures: list[str] = []
    for seed in seeds:
        case = fixture(seed)
        record = case.server_record
        by_kind = _by_kind(case)
        honest = by_kind["honest"]
        expected = b64url_decode(str(honest["authenticatorData"])) + hashlib.sha256(
            b64url_decode(str(honest["clientDataJSON"]))
        ).digest()
        try:
            if module.signed_message(honest) != expected:
                failures.append("signed bytes do not match the WebAuthn assertion shape")
            if module.verify_signature(record["publicKey"], honest) is not True:
                failures.append("an honest signature was rejected")
            if module.verify_signature(record["publicKey"], by_kind["no-uv"]) is not True:
                failures.append("UV=0 changed cryptographic signature validity")
            if module.verify_signature(record["publicKey"], by_kind["wrong-rp"]) is not True:
                failures.append("the valid signature over a different rpIdHash was rejected too early")
            if module.verify_signature(record["publicKey"], by_kind["bad-signature"]) is not False:
                failures.append("a damaged signature was accepted")
            tampered = copy.deepcopy(honest)
            raw = bytearray(b64url_decode(str(tampered["clientDataJSON"])))
            raw[-2] ^= 1
            import base64
            tampered["clientDataJSON"] = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
            if module.verify_signature(record["publicKey"], tampered) is not False:
                failures.append("clientDataJSON was not bound to the signature")
        except Exception as error:  # noqa: BLE001 - learner code is untrusted
            failures.append(f"signature functions raised {type(error).__name__}")
        if failures:
            break
    return failures


def _find_failures(module: ModuleType, seeds: list[str]) -> list[str]:
    failures: list[str] = []
    answers: set[str] = set()
    for seed in seeds:
        case = fixture(seed)
        expected = case.aliases_by_kind["no-uv"]
        answers.add(expected)
        try:
            actual = module.find_signed_without_user_verification(
                case.server_record, list(case.assertions)
            )
            if actual != expected:
                failures.append("did not find the one valid signature whose UV bit is zero")
                break
        except Exception as error:  # noqa: BLE001 - learner code is untrusted
            failures.append(f"UV-gap search raised {type(error).__name__}")
            break
    if len(answers) < 4:
        failures.append("hidden seeds did not vary the expected assertion id")
    return failures


def _policy_failures(module: ModuleType, seeds: list[str]) -> list[str]:
    expected = {
        "honest": {"ok": True, "reason": "ok"},
        "no-uv": {"ok": False, "reason": "user-verification-required"},
        "bad-signature": {"ok": False, "reason": "signature-invalid"},
        "wrong-rp": {"ok": False, "reason": "rp-id-mismatch"},
    }
    for seed in seeds:
        case = fixture(seed)
        by_kind = _by_kind(case)
        try:
            for kind, verdict in expected.items():
                actual = module.verify_assertion(case.server_record, by_kind[kind], True)
                if actual != verdict:
                    return [f"{kind} produced the wrong one-reason verdict"]
            relaxed = module.verify_assertion(case.server_record, by_kind["no-uv"], False)
            if relaxed != {"ok": True, "reason": "ok"}:
                return ["UV=0 was rejected even when the server policy did not require UV"]
            malformed = {"id": "broken"}
            malformed_verdict = module.verify_assertion(case.server_record, malformed, True)
            if malformed_verdict != {"ok": False, "reason": "malformed-assertion"}:
                return ["malformed input did not fail closed with one reason"]
        except Exception as error:  # noqa: BLE001 - learner code is untrusted
            return [f"policy verifier raised {type(error).__name__}"]
    return []


def run(module: ModuleType, seed: str, checkpoint: str | None = None) -> list[str]:
    if checkpoint is not None and checkpoint not in CHECKPOINTS:
        return ["unknown checkpoint"]
    seeds = [f"{seed}:hidden:{index}" for index in range(8)]
    if checkpoint in (None, "signature"):
        failures = _signature_failures(module, seeds)
        if failures:
            return failures
    if checkpoint in (None, "find-uv-gap"):
        failures = _find_failures(module, seeds)
        if failures:
            return failures
    if checkpoint in (None, "enforce-uv"):
        failures = _policy_failures(module, seeds)
        if failures:
            return failures
    return []
