"""Inspect evidence: public settings and one organization's complete example shares."""

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
    print("health marker (no answer required):", payload["healthToken"])
    print("field p       :", p)
    print("organizations :", parties)
    print("public bias   :", params["bias"])
    print()
    print("Public example: all additive pieces are shown; their sum modulo p recovers each value.")
    print("公開例は全破片を表示します。合計をpで割った余りから元の数を復元できます。")
    triple = payload["triples"][0]
    print(json.dumps({
        "counts[0]": payload["counts"][0],
        "severities[0]": payload["severities"][0],
        "triple_list[0].a": triple["a"],
        "triple_list[0].b": triple["b"],
        "triple_list[0].c": triple["c"],
    }, indent=2))
    print()
    print(f"score = sum of {parties} products, plus a public bias, mod {p}")
    print()
    print("This one-program model holds all shares. The privacy check observes open_batch only.")
    print("この模型のPythonは全破片を持ちます。privacyが観察するのはopen_batchです。")
    print("Count the products and the opening rounds separately; begin with plan(spec).")
    print("積の数と開示の呼出し回数を分け、まずplan(spec)から始めてください。")


if __name__ == "__main__":
    main()
