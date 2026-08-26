"""`make inspect` -- print this deployment's public server record and assertions."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's public half, and every value printed below.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). It defines `signed_message` under the exact
    name `starter/assertion.py` asks the learner to write, and `fixture()` labels every
    assertion by kind for any seed a caller names -- including the hidden suite's, which
    follow from the learner's own `FLAG_SEED`. The verifier, which is the only image that
    still carries `fixtures/`, serves the public half over `GET /public`:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, `VERIFIER_PUBLIC_URL`
    when this process must fetch it itself.
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
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down
            # deployment -- say which service is missing instead of printing a urllib
            # traceback at somebody trying to read their fixtures.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 543 option B2. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> None:
    deployment = _public_payload()["deployment"]
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
    print(json.dumps(deployment["serverRecord"], indent=2, sort_keys=True))
    print()
    print("The record has a publicKey, expected site/origin/challenge, and credential id.")
    print("It has no credential private key and no password-equivalent verifier.")
    print()
    print("== four received assertions ==")
    print(json.dumps(deployment["assertions"], indent=2, sort_keys=True))
    print()
    print("Exactly one is a completely valid login. Exactly one has a valid signature and")
    print("valid context but UV=0. The other two each have exactly one different defect.")
    print("The WebAuthn id matches serverRecord. The lab-only caseId and order change with FLAG_SEED.")
    print("Do not guess from caseId. Complete assertion.py,")
    print("run the tests, and submit that source to all three checkpoints.")


if __name__ == "__main__":
    main()
