"""`make inspect` — the audit log you were handed, and what is not in it."""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It holds `audit_log`,
    whose return value carries `victim_secret` -- the `hunt` checkpoint's answer as a
    value -- beside the records; `secret_key`, which derives every key in this deployment
    from the seed the participant container already has in its environment; and
    `deterministic_nonce`, which is the `repair` checkpoint's answer with a docstring
    explaining it. `make inspect` now runs through Compose (see the Makefile) so this
    process can reach the verifier over the network instead.
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
            # traceback at somebody trying to read their log.
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


def _as_point(value: object) -> object:
    """Render a coordinate pair the way the in-process log always rendered it."""
    if isinstance(value, list):
        return tuple(value)
    return value


def main() -> None:
    payload = public_evidence()
    group = payload["group"]
    records = payload["records"]
    assert isinstance(group, dict)
    assert isinstance(records, list)

    print("health token :", payload["healthToken"])
    print(
        f"group        : y^2 = x^3 + {group['a']}x + {group['b']} "
        f"(mod {group['p']}), order n = {group['n']}"
    )
    print(f"records      : {len(records)}")
    print()
    print("the log holds, per signature: message, public key, commitment R, response z.")
    print("it does not hold any secret key. that was the point of keeping a log.")
    print()
    print("  #   public key        commitment        response")
    for index, record in enumerate(records):
        public = _as_point(record.get("public_key"))
        commitment = _as_point(record.get("commitment"))
        response = record.get("response")
        print(f"  {index:<3} {str(public):<17} {str(commitment):<17} {response}")
    print()
    counts = Counter(str(_as_point(record.get("commitment"))) for record in records)
    repeated = [value for value, count in counts.items() if count > 1]
    print(f"commitments appearing more than once: {repeated or 'none'}")
    print()
    print("Some rows are malformed. At least one parses cleanly and does not verify.")
    print("Not every duplicate is an opportunity — work out which ones are.")
    print()
    print(f"The weak generator in participant.schnorr draws from {payload['nonceSpace']} values.")
    print("Predict how many collisions 40 draws produce before you measure it.")


if __name__ == "__main__":
    main()
