"""`make inspect` -- print this deployment's public server record and assertions."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import fixture

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    case = fixture(SEED)
    print("== the whole login, before the vocabulary ==")
    print("  authenticator (phone/laptop)              relying-party server")
    print("  keeps credential private key              stores credential public key")
    print("          |                                            ^")
    print("          | signs challenge + flags                   | verifies")
    print("          +-------------- assertion ------------------+")
    print()
    print("A public key is the half the server may store and show. It checks a signature but")
    print("cannot create one. The matching private key stays with the authenticator.")
    print("An assertion is the signed login reply. Its authenticatorData contains a 32-byte")
    print("site hash, one flags byte, and a four-byte counter in this lab.")
    print()
    print("flags byte: bit 0 (0x01) = somebody was present; bit 2 (0x04) = the")
    print("authenticator performed local user verification such as a PIN or biometric.")
    print("The signature protects that flags byte. A protected zero is still zero: the")
    print("server must reject it when its policy requires user verification.")
    print()
    print("== server record (notice what is absent) ==")
    print(json.dumps(case.server_record, indent=2, sort_keys=True))
    print()
    print("The record has a publicKey, expected site/origin/challenge, and credential id.")
    print("It has no credential private key and no password-equivalent verifier.")
    print()
    print("== four received assertions ==")
    print(json.dumps(list(case.assertions), indent=2, sort_keys=True))
    print()
    print("Exactly one is a completely valid login. Exactly one has a valid signature and")
    print("valid context but UV=0. The other two each have exactly one different defect.")
    print("The WebAuthn id matches serverRecord. The lab-only caseId and order change with FLAG_SEED.")
    print("Do not guess from caseId. Complete assertion.py,")
    print("run the tests, and submit that source to all three checkpoints.")


if __name__ == "__main__":
    main()
