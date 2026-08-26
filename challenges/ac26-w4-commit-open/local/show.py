"""`make inspect` — the vector, the tree, and the query."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict[str, object]:
    """This deployment's public evidence -- the vector, the query, the leaf hashes, the
    root, and the opening path -- the same things `verifier/server.py`'s `GET /public`
    serves.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). Its `node_hash` is a
    complete Merkle node-combining function under the exact name the starter's own
    `node_hash` stub asks the learner to write, so keeping it reachable here handed
    over a working implementation regardless of where any comparison lived. `make
    inspect` now runs through Compose (see the Makefile) so this process can reach the
    verifier over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Compose health-gates the workbench on the verifier, so this normally
            # cannot happen. When it does -- a `docker compose run` against a torn-down
            # deployment -- say which service is missing instead of printing a urllib
            # traceback at somebody trying to read their fixtures.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> None:
    payload = _public_payload()
    cfg = payload["setting"]
    values, index = cfg["values"], cfg["query"]

    print("health token :", payload["healthToken"])
    print(f"vector length: {cfg['length']}   (a power of two, so no level is ragged)")
    print(f"domain       : {cfg['domain']}")
    print(f"the verifier will ask about index {index}")
    print()
    print("  i     value    leaf hash")
    leaf_hashes = payload["leafHashesHex"]
    for position, value in enumerate(values):
        marker = " <- asked" if position == index else ""
        print(f"  {position:<5} {value:<8} {leaf_hashes[position][:16]}...{marker}")
    print()
    print(f"root         : {payload['rootHex']}")
    print(f"tree levels  : {payload['treeLevels']}   path length: {payload['treeLevels'] - 1}")
    print()
    print("the authentication path for that index:")
    for step, entry in enumerate(payload["openingForQuery"]):
        side = "left" if entry["siblingIsLeft"] else "right"
        print(f"  step {step}: sibling on the {side:<5} {entry['hashHex'][:16]}...")
    print()
    print("Three steps, in order: commit, then challenge, then open.")
    print("Work out what changes if the prover learns the query first.")


if __name__ == "__main__":
    main()
