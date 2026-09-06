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
    print("  (算術模型 / arithmetic model: this screen gathers multiple parties’ shares.)")
    print()
    print("== 事前に用意した三つ組 / preprocessed triple ==")
    for name in ("a", "b", "c"):
        print(f"  shares of {name}: {json.dumps(triple[name])}")
    print("  c = (a*b) % p. Each full row below can be reconstructed by sum(row) % p.")
    print()
    print("== x の share 一覧 / shares of x, one entry per party ==")
    print(f"  {json.dumps(payload['xShares'])}")
    print()
    print("== the protocol ==")
    print("  d_i = (x_i - a_i) % p     each party, locally")
    print("  e_i = (y_i - b_i) % p     each party, locally")
    print("  d=sum(d_i)%p, e=sum(e_i)%p    one batched opening round")
    print("  x*y % p = (c + d*b + e*a + d*e) % p")
    print()
    print("  実際の参加者は自分の share だけを持ちます。この一覧は秘匿を保証しません。")
    print("  A real party holds its own share; this teaching view does not promise secrecy.")
    print()
    print(f"health token: {payload['healthToken']}")


if __name__ == "__main__":
    main()
