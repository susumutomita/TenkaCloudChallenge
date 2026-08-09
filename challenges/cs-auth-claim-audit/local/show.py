"""`make inspect` — the token you were handed, and the log you were asked to audit."""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import decision_log, health_token, keyring, public_request

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _decode(segment: str) -> object:
    padded = segment + "=" * (-len(segment) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    except Exception:  # noqa: BLE001 - `inspect` shows what is there, including junk
        return "<not decodable>"


def main() -> None:
    request = public_request(SEED)
    token = str(request["token"])
    head, body, mac = token.split(".")

    print("health token :", health_token(SEED))
    print()
    print("The gateway's signing keys (you are the auditor; you have the config):")
    for kid, secret in keyring(SEED).items():
        print(f"  {kid}  {secret[:16]}... ({len(secret) // 2} bytes)")
    print()
    print("One request the gateway handled, in full:")
    print(f"  token    {token}")
    print(f"  header   {_decode(head)}")
    print(f"  payload  {_decode(body)}")
    print(f"  mac      {mac}")
    print(f"  action   {request['action']}")
    print(f"  resource {request['resource']}")
    print(f"  now      {request['now']}")
    print()
    print("`nbf` is the first instant this token is usable. `exp` is when it stops being")
    print("usable. Those two sentences do not use the same comparison, and the `window`")
    print("checkpoint is about which one each of them gets.")
    print()

    entries, _wrong = decision_log(SEED)
    print(f"The gateway's decision log ({len(entries)} rows):")
    print()
    print("  #   decision  action          resource                    now")
    for index, entry in enumerate(entries):
        resource = entry["resource"]
        assert isinstance(resource, dict)
        where = f"{resource['id']} ({resource['tenant']})"
        print(
            f"  {index:<3} {str(entry['gatewayDecision']):<9} "
            f"{str(entry['action']):<15} {where:<27} {entry['now']}"
        )
    print()
    print("Every token in the log is printed by the Portal editor's inspect view; they are")
    print("too long to line up here. Recompute the MACs yourself — you have the keys.")
    print()
    print("This gateway refuses expired tokens, refuses tokens whose payload was edited,")
    print("and refuses actions the token does not carry. It has been in production for")
    print("months and nobody has complained. Some of the rows it allowed should not have")
    print("been allowed. Which ones, and what do they have in common?")


if __name__ == "__main__":
    main()
