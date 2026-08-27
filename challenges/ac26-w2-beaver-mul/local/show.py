"""`make inspect` — your setting, your triple's shares, and the protocol on one page."""

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
    `participant` Docker stage any more (see local/Dockerfile). Its `setting()` returns
    x, y, a, b and c in the clear -- enough to print this deployment's product without
    writing `combine` -- and it shipped beside `tests/hidden/check_beaver.py`, which
    carries the assertions every checkpoint is graded by. `make inspect` now runs through
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
    triple = payload["triple"]
    print(f"== your setting ==\n  modulus p = {p}\n  parties  n = {n}")
    print("  (x, y, a, b and c are all shared -- nobody holds any of them in the clear)")
    print()
    print("== the preprocessed triple, as each party holds it ==")
    for name in ("a", "b", "c"):
        print(f"  shares of {name}: {json.dumps(triple[name])}")
    print("  The triple satisfies c = a*b. It was generated before anyone knew x or y.")
    print()
    print("== shares of x, one row per party ==")
    print(f"  {json.dumps(payload['xShares'])}")
    print()
    print("== the protocol ==")
    print("  d = x - a          each party, locally")
    print("  e = y - b          each party, locally")
    print("  open d, open e     one round")
    print("  x*y = c + d*b + e*a + d*e")
    print()
    print("  Before you write combine: three of those four terms are like each other.")
    print("  One is not. Which one, and what does that change?")
    print()
    print(f"health token: {payload['healthToken']}")


if __name__ == "__main__":
    main()
