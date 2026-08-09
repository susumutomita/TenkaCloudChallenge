"""Public tests: only the delivered message is checked.

This deliberately does not inspect the request or ciphertext transcript. Returning
the choice in clear and sending both messages unchanged passes this file.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUBMISSION = Path(os.environ.get("SUBMISSION_DIR", str(ROOT / "starter")))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SUBMISSION))

import ot  # noqa: E402
from fixtures.generate import cases  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_selected_messages() -> str:
    for item in cases(SEED, "public", 4):
        request = ot.make_receiver_request(
            item.sender_public, item.choice, item.receiver_secret
        )
        ciphertexts = ot.seal_sender_messages(
            item.sender_secret, request, item.message_0, item.message_1
        )
        opened = ot.open_receiver_message(
            item.sender_public, item.choice, item.receiver_secret, ciphertexts
        )
        expected = (item.message_0, item.message_1)[item.choice]
        if opened != expected:
            return "the receiver did not get the selected message"
    return ""


CHECKS = (("selected-messages", check_selected_messages),)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failures = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - learner feedback
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failures += 1
        else:
            print(f"ok   {name}")
    if failures:
        print(f"\npublic tests: {failures} failed")
    else:
        print("\npublic tests: all passed")
        print("Only final delivery was checked. Privacy has not been tested.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
