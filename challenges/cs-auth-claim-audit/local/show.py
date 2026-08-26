"""`make inspect` — the token you were handed, the log you were asked to audit.

The shape here is the shape the Portal serves from `/api/inspect`; both build it from
the same public payload, and `scripts/cs-foundations-evidence.test.ts` asserts the two
are identical. The gateway's signing keys are handed over deliberately: an auditor who
cannot recompute a MAC cannot separate a forged token from a genuine one.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def evidence(seed: str) -> dict[str, object]:
    """This deployment's public evidence. Contains no expected answer.

    Issue 543/537: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile) -- keeping its seed-keyed generators
    reachable here, even with `window`'s and `audit`'s own answers moved out to
    `fixtures.generate.validity_window` and `verifier/expected.py`, still handed a
    learner everything needed to derive them with nothing but their own container's
    seed. `make inspect` now runs through Compose (see the Makefile) so this process
    can reach the verifier, which is the only place `fixtures/` still lives, over the
    network instead.
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

    return public_payload(seed)


def main() -> None:
    print(json.dumps(evidence(SEED), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
