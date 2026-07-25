"""`make inspect` — the policy, the deployed circuit, and the honest witnesses."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import clean_witness, health_token, honest_witness, params, vulnerable_circuit

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    prm = params(SEED)
    print("== the policy ==")
    print("  grant access iff the revocation counter is zero AND the issuer is recognised")
    print()
    print(f"== parameters ==\n  {json.dumps(prm)}")
    print("  (revoked != 0 here: this credential really is revoked)")
    print()
    print("== the circuit that was deployed ==")
    for constraint in vulnerable_circuit(SEED):
        print(f"  {json.dumps(constraint)}")
    print("  One constraint the policy needs is not in this list.")
    print()
    print("== honest witnesses (both must stay accepted after your repair) ==")
    print(f"  revoked credential: {json.dumps(honest_witness(prm))}")
    print(f"  clean credential:   {json.dumps(clean_witness(prm))}")
    print()
    print("== the is-zero gadget ==")
    print("  iszero_a:  value * inv + out - 1 = 0")
    print("  iszero_b:  value * out           = 0")
    print()
    print(f"health token: {health_token(SEED)}")


if __name__ == "__main__":
    main()
