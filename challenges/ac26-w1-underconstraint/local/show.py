"""`make inspect` — the policy, the deployed circuit, and the honest witnesses.

Everything printed here is this deployment's public half, read from the verifier's
`GET /public` rather than derived locally: `fixtures/generate.py` does not ship in the
participant image any more (Issue 537/543 option B2), because `_ISZERO_HALVES` there is
the `build` checkpoint's answer. The values below are the same ones this file has always
printed — the parameters, the circuit that was deployed, both honest witnesses and the
gadget's two formulas. Which constraint is missing is still not among them.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.evidence import public_evidence

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    evidence = public_evidence()
    print("== the policy ==")
    print(f"  {evidence['policy']}")
    print()
    print(f"== parameters ==\n  {json.dumps(evidence['parameters'])}")
    print("  (revoked != 0 here: this credential really is revoked)")
    print()
    print("== the circuit that was deployed ==")
    for constraint in evidence["deployedCircuit"]:
        print(f"  {json.dumps(constraint)}")
    print("  One constraint the policy needs is not in this list.")
    print()
    print("== honest witnesses (both must stay accepted after your repair) ==")
    print(f"  revoked credential: {json.dumps(evidence['honestWitnesses']['revokedCredential'])}")
    print(f"  clean credential:   {json.dumps(evidence['honestWitnesses']['cleanCredential'])}")
    print()
    print("== the is-zero gadget ==")
    print(f"  iszero_a:  {evidence['iszeroGadget']['iszero_a']}")
    print(f"  iszero_b:  {evidence['iszeroGadget']['iszero_b']}")
    print()
    print(f"health token: {evidence['healthToken']}")


if __name__ == "__main__":
    main()
