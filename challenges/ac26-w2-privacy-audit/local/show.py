"""`make inspect` — your specification, one real trace, and your health token.

Prints the clean program's trace so you can see the event shape. It does not print any
leaking program: finding those is the exercise.
"""

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
    `participant` Docker stage any more (see local/Dockerfile). Its `TRUTH` names the
    verdict for each of the seven programs by id, and it shipped beside
    `tests/hidden/check_auditor.py`, whose `_expected_index` and `_leaks` state the
    decision rule `first_violation` exists to make a learner derive. `make inspect` now
    runs through Compose (see the Makefile) so this process can reach the verifier over
    the network instead.
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
    public_spec = payload["spec"]
    print("health token :", payload["healthToken"])
    print("field p      :", public_spec["p"])
    print("parties      :", ", ".join(public_spec["parties"]))
    print()
    print("specification (this is what your auditor is given):")
    print(json.dumps(public_spec, indent=2))
    print()
    print("a clean run's events:")
    for index, event in enumerate(payload["cleanEvents"]):
        shown = {key: value for key, value in event.items() if value not in ("", 0)}
        print(f"  [{index:2d}] {json.dumps(shown)}")
    print()
    print("The graded runs include programs that leak. Every one of them returns the")
    print("same, correct total -- so the output tells you nothing about which is which.")


if __name__ == "__main__":
    main()
