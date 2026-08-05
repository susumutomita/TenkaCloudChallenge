"""`make inspect` — your field, your circuit, and two witnesses to compare.

Everything comes from FLAG_SEED, so these numbers are yours.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    allowed_set,
    broken_witness,
    circuit,
    field_modulus,
    health_token,
    honest_witness,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    print(f"== field ==\n  p = {field_modulus(SEED)}")
    print(f"  allowed set for the membership gadget: {allowed_set(SEED)}")
    print()
    print("== circuit ==")
    for constraint in circuit(SEED):
        print(f"  {json.dumps(constraint)}")
    print()
    print("== an honest witness ==")
    print(f"  {json.dumps(honest_witness(SEED))}")
    print("  Every residual should be zero. Predict that before you run your trace.")
    print()
    print("== a broken witness (checkpoint: first-broken) ==")
    witness, _expected = broken_witness(SEED)
    print(f"  {json.dumps(witness)}")
    print("  Exactly one constraint is violated first.")
    print('  Submit that trace row as {"constraintId":"...","residual":...}.')
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
