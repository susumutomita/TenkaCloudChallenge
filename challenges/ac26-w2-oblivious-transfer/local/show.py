"""Evidence shown by make inspect."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (  # noqa: E402
    GENERATOR,
    GROUP_ORDER,
    GROUP_PRIME,
    case,
    health_token,
    request_for,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    item = case(SEED, "public", 0)
    print("health token :", health_token(SEED))
    print("toy group    :", f"g={GENERATOR}, order={GROUP_ORDER}, modulo={GROUP_PRIME}")
    print()
    print("one deployment-derived worked input:")
    print(json.dumps(item.public_view(), indent=2))
    print("request for choice 0:", request_for(
        item.sender_public, 0, item.receiver_secret
    ))
    print()
    print("Shape to implement:")
    print("  B = g^b * A^choice")
    print("  sender keys = B^a and (B / A)^a")
    print("  receiver key = A^b")
    print("  pad(K, i) = first 16 bits, big endian, of SHA-256")
    print("              over ASCII tc-ot-v1:{K}:{i}")
    print("  ciphertext_i = message_i XOR pad(branch_key_i, i)")
    print()
    print("The public test checks only the selected message. The privacy checkpoints")
    print("separately inspect whether B reveals the choice and whether either side")
    print("can recover a message it was not meant to learn.")


if __name__ == "__main__":
    main()
