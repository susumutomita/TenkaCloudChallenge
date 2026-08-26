"""`make inspect` — your statement, the three verifiers, and a public transcript.

Everything here comes from FLAG_SEED, so these numbers are yours alone.
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
    reachable here, even with `privacy-leak`'s own comparison staying where it was,
    still handed a learner the witness (and the undisclosed boundary instance behind
    `incompleteness`) for the price of one `import`. `make inspect` now runs through
    Compose (see the Makefile) so this process can reach the verifier, which is the
    only place `fixtures/` still lives, over the network instead.
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
    print("== the claim ==")
    print("  'I know w with  a*w + b == c (mod p)  and  lo <= w <= hi'")
    print()
    print("== your statement (checkpoints: unsoundness, privacy-leak) ==")
    print(f"  {json.dumps(evidence['statement'])}")
    print()
    print("== what each verifier checks ==")
    for protocol_id, checked in evidence["verifiers"].items():
        print(f"  {protocol_id}: {', '.join(str(item) for item in checked)}")
    print()
    privacy_protocol = evidence["privacyProtocol"]
    print(f"== a {privacy_protocol} transcript, as an observer would see it ==")
    print(f"  {json.dumps(evidence['transcript'])}")
    print()
    print(f"health token: {evidence['healthToken']}")


if __name__ == "__main__":
    main()
