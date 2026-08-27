"""`make inspect` — your setting, the shape of what you are handed, and your token."""

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
    `participant` Docker stage any more (see local/Dockerfile). It derives the secret
    counts and severities every checkpoint is graded against, and it shipped beside
    `tests/hidden/check_aggregate.py`, whose assertions state this problem's answers --
    the three numbers `plan` must return among them. `make inspect` now runs through
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
    params = payload["params"]
    p, parties = params["p"], params["parties"]
    print("health token  :", payload["healthToken"])
    print("field p       :", p)
    print("organizations :", parties)
    print("public bias   :", params["bias"])
    print()
    print("what your protocol is handed (values shown are shares, not secrets):")
    triple = payload["triples"][0]
    print(json.dumps({
        "counts[0]": payload["counts"][0],
        "severities[0]": payload["severities"][0],
        "triple[0].a": triple["a"],
        "triple[0].b": triple["b"],
        "triple[0].c": triple["c"],
    }, indent=2))
    print()
    print(f"score = sum of {parties} products, plus a public bias, mod {p}")
    print()
    print("Both factors of every product are secret. Count the multiplications, then")
    print("count the rounds. They are not the same number, and only one of them is")
    print("forced by the expression.")


if __name__ == "__main__":
    main()
