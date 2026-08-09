"""Evidence shown by make inspect."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import gate_case, health_token  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    item = gate_case(SEED, "public", 1, 1)
    print("health token :", health_token(SEED))
    print()
    print("one deployment-derived sharing:")
    print(json.dumps(item.as_public(), indent=2))
    print()
    print("Expand the secret product:")
    print("  (x0 xor x1) AND (y0 xor y1)")
    print("    = x0*y0 xor x0*y1 xor x1*y0 xor x1*y1")
    print()
    print("x0*y0 and x1*y1 are local. The fixture supplies two ideal OT sessions")
    print("for the cross terms. The public truth table cannot tell whether you used")
    print("them or reconstructed x and y, so the audit checkpoint records the path.")
    print()
    print("Fixture API:")
    print("  local(shares, party) -> that party's local bit")
    print("  transfer(session, sender, receiver, (m0, m1), choice) -> selected message")
    print("Required directions: session 0 is party 0 -> 1; session 1 is party 1 -> 0.")


if __name__ == "__main__":
    main()
