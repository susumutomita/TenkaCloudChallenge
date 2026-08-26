"""`make inspect` — your field, your circuit, and two witnesses to compare.

Everything comes from FLAG_SEED, so these numbers are yours.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_evidence() -> dict[str, object]:
    """This deployment's public evidence.

    Issue 543/537: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile) -- keeping its seed-keyed generators
    reachable here, even with `first-broken`'s own comparison staying in
    `verifier/server.py`, still handed a learner the diagnosis for the price of one
    `import`. `make inspect` now runs through Compose (see the Makefile) so this
    process can reach the verifier, which is the only place `fixtures/` still lives,
    over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    # Resolves only against a checkout with fixtures/ still on disk (never true inside
    # a built participant image -- see the docstring above).
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> None:
    evidence = _public_evidence()
    print(f"== field ==\n  p = {evidence['field']['p']}")
    print(f"  allowed set for the membership gadget: {evidence['field']['allowedSet']}")
    print()
    print("== circuit ==")
    for constraint in evidence["circuit"]:
        print(f"  {json.dumps(constraint)}")
    print()
    print("== an honest witness ==")
    print(f"  {json.dumps(evidence['honestWitness'])}")
    print("  Every residual should be zero. Predict that before you run your trace.")
    print()
    print("== a broken witness (checkpoint: first-broken) ==")
    print(f"  {json.dumps(evidence['brokenWitness'])}")
    print("  Exactly one constraint is violated first.")
    print('  Submit that trace row as {"constraintId":"...","residual":...}.')
    print()
    print(f"health token: {evidence['healthToken']}")


if __name__ == "__main__":
    main()
