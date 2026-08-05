"""`make inspect` — your statement, the three verifiers, and a public transcript.

Everything here comes from FLAG_SEED, so these numbers are yours alone.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import health_token, instance, protocol_for, protocol_ids, verify

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    inst = instance(SEED)
    print("== the claim ==")
    print("  'I know w with  a*w + b == c (mod p)  and  lo <= w <= hi'")
    print()
    print("== your statement (checkpoints: unsoundness, privacy-leak) ==")
    print(f"  {json.dumps(inst.as_public())}")
    print()
    print("== what each verifier checks ==")
    for protocol_id in protocol_ids(SEED):
        _accepted, transcript = verify(protocol_id, inst, inst.witness)
        checked = ", ".join(str(item) for item in transcript["checked"])
        print(f"  {protocol_id}: {checked}")
    print()
    privacy_protocol = protocol_for(SEED, "leaky")
    print(f"== a {privacy_protocol} transcript, as an observer would see it ==")
    _accepted, transcript = verify(privacy_protocol, inst, inst.witness)
    print(f"  {json.dumps(transcript)}")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
