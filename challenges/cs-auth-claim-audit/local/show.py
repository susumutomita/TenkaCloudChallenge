"""`make inspect` — the token you were handed, the log you were asked to audit.

The shape here is the shape the Portal serves from `/api/inspect`; both build it from
`evidence()` below, and `scripts/cs-foundations-evidence.test.ts` asserts the two are
identical. The gateway's signing keys are handed over deliberately: an auditor who
cannot recompute a MAC cannot separate a forged token from a genuine one.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import QUESTIONS, decision_log, health_token, keyring, public_request

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _decode(segment: str) -> object:
    padded = segment + "=" * (-len(segment) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except Exception:  # noqa: BLE001 - `inspect` shows what is there, including junk
        return "<not decodable>"


def evidence(seed: str) -> dict[str, object]:
    """Everything a participant may see. Contains no expected answer."""
    request = public_request(seed)
    token = str(request["token"])
    head, body, mac = token.split(".")
    entries, _wrong = decision_log(seed)
    return {
        "environment": {"healthToken": health_token(seed)},
        "window": {
            **QUESTIONS["window"],
            "token": token,
            "header": _decode(head),
            "claims": request["claims"],
            "mac": mac,
            "handled": {
                "action": request["action"],
                "resource": request["resource"],
                "now": request["now"],
            },
        },
        "audit": {
            **QUESTIONS["audit"],
            "keys": keyring(seed),
            "entries": [{"index": index, **entry} for index, entry in enumerate(entries)],
        },
    }


def main() -> None:
    print(json.dumps(evidence(SEED), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
