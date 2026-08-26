"""`make inspect` — your setting, your shares, and the four operations to classify."""

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
    stage any more (see local/Dockerfile). Alongside the setting and the shares it also
    derives what `no-communication` is graded against, as plain module data -- so
    keeping the module reachable here handed that checkpoint over no matter where the
    comparison itself lived. `make inspect` now runs through Compose (see the Makefile)
    so this process can reach the verifier, which is the only place `fixtures/` still
    lives, over the network instead.
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
    cfg = evidence["setting"]
    p, n, c = cfg["p"], cfg["n"], cfg["c"]
    print(f"== your setting ==\n  modulus p = {p}\n  parties  n = {n}\n  public constant c = {c}")
    print("  (x and y are not printed -- they are the shared secrets)")
    print()
    print("== shares of x, one row per party ==")
    for index, value in enumerate(evidence["sharesOfX"]):
        print(f"  party {index}: {value}")
    print()
    print("== the four operations ==")
    for operation in evidence["operations"]:
        print(f"  {operation}")
    print("  For each: can every party act alone on its own share, or must they talk?")
    print("  Write your answer down before you run anything.")
    print()
    print("== the one to slow down on ==")
    print(f"  If all {n} parties each add c to their own share, what does the set sum to?")
    print(f"  Work it out on paper: it is not x + {c}.")
    print()
    print(f"health token: {evidence['healthToken']}")


if __name__ == "__main__":
    main()
