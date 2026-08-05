"""Break the reference in security-relevant ways and require every break to die."""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden.check_assertion import run

REFERENCE = (ROOT / "reference" / "assertion.py").read_text(encoding="utf-8")
SEED = "passkey-mutation-suite"

MUTATIONS = [
    (
        "signs raw clientDataJSON instead of its hash",
        "return authenticator_data + hashlib.sha256(client_data).digest()",
        "return authenticator_data + client_data",
        "signature",
    ),
    (
        "accepts every ECDSA signature",
        "return _ecdsa_verify(public_key, message, signature)",
        "return True",
        "signature",
    ),
    (
        "reads UP as though it were UV",
        "bool(authenticator_data[32] & FLAG_UV)",
        "bool(authenticator_data[32] & FLAG_UP)",
        "find-uv-gap",
    ),
    (
        "returns the first assertion without checking it",
        "return matches[0] if len(matches) == 1 else \"\"",
        "return str(assertions[0].get(\"id\", \"\"))",
        "find-uv-gap",
    ),
    (
        "does not enforce the UV requirement",
        "if require_user_verification and not user_verified(assertion):",
        "if False and require_user_verification and not user_verified(assertion):",
        "enforce-uv",
    ),
    (
        "does not verify the signature in the final policy",
        "if not isinstance(public_key, dict) or not verify_signature(public_key, assertion):",
        "if not isinstance(public_key, dict):",
        "enforce-uv",
    ),
]


def _load(source: str, name: str) -> ModuleType:
    module = ModuleType(name)
    exec(compile(source, f"<{name}>", "exec"), module.__dict__)  # noqa: S102 - author fixtures
    return module


def main() -> int:
    reference = _load(REFERENCE, "reference")
    if run(reference, SEED):
        print("FAIL reference implementation does not pass the hidden suite")
        return 1
    print("PASS reference implementation passes the hidden suite")

    survivors: list[str] = []
    for index, (name, old, new, checkpoint) in enumerate(MUTATIONS):
        if REFERENCE.count(old) != 1:
            print(f"FAIL mutation anchor for {name!r} is not unique")
            return 1
        mutant = _load(REFERENCE.replace(old, new), f"mutant_{index}")
        failures = run(mutant, SEED, checkpoint)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    if survivors:
        print(f"\n{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
