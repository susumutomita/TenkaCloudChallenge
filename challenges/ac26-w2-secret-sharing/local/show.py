"""`make inspect` — your setting, and what a partial view actually looks like."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). Its `reference_shares`
    builds a correct split of this deployment's secret -- the `share` half of the first
    checkpoint -- and it shipped beside `tests/hidden/check_sharing.py`, which carries the
    assertions four of the five checkpoints are graded by. `make inspect` now runs through
    Compose (see the Makefile) so this process can reach the verifier over the network
    instead.
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
    p, n = payload["params"]["p"], payload["params"]["n"]
    print(f"== your setting ==\n  modulus p = {p}\n  parties  n = {n}")
    print("  (the secret is not printed -- that is rather the point)")
    print()
    print("== what party 0 through n-2 can see between them ==")
    print(f"  {json.dumps(payload['partialShares'])}")
    print("  Ask yourself, before running anything: which secrets are consistent with")
    print("  those values? Write your answer down, then make complete_shares prove it.")
    print()
    print("== randomness you are given ==")
    print(f"  for share:      {json.dumps(payload['shareRandomness'])}")
    print(f"  for share_line: {json.dumps(payload.get('lineRandomness', []))}")
    print("  (the second list is the slope for the two-of-three field; the graded")
    print("   runs use other moduli, some around 10000)")
    print()
    print(f"health token: {payload['healthToken']}")


if __name__ == "__main__":
    main()
