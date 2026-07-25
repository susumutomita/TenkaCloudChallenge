"""`make inspect` — your statement, the three verifiers, and the P3 transcript.

Everything here comes from FLAG_SEED, so these numbers are yours alone.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import boundary_instance, health_token, instance, verify

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    inst = instance(SEED)
    boundary = boundary_instance(SEED)

    print("== the claim ==")
    print("  'I know w with  a*w + b == c (mod p)  and  lo <= w <= hi'")
    print()
    print("== your statement (checkpoints: unsoundness, privacy-leak) ==")
    print(f"  {json.dumps(inst.as_public())}")
    print()
    print("== boundary statement (checkpoint: incompleteness) ==")
    print(f"  {json.dumps(boundary.as_public())}")
    print("  Its honest witness sits exactly on one end of the range.")
    print()
    print("== what each verifier checks ==")
    for protocol_id in ("p1", "p2", "p3"):
        _accepted, transcript = verify(protocol_id, inst, inst.witness)
        checked = ", ".join(str(item) for item in transcript["checked"])
        print(f"  {protocol_id}: {checked}")
    print()
    print("== a P3 transcript, as an observer would see it ==")
    _accepted, transcript = verify("p3", inst, inst.witness)
    print(f"  {json.dumps(transcript)}")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
