"""`make inspect` — the fields this deployment draws from, and one worked transform.

    make inspect

This prints orientation material only: which primes the hidden phases draw from, which
orders are legal in each, and a single worked evaluation so the shape of the answer is
concrete. It does not print which parameters the starter's rule gets wrong, and nothing
it can reach decides that.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile), because it shipped beside
    `tests/hidden/check_ntt.py` -- whose `has_order` is the "order exactly n" decision
    written out from the definition, next to `naive_omega`, the rule the shipped starter
    trusts. That decision is the whole of what `starter/ntt.py` says the learner has to
    add. `make inspect` now runs through Compose (see the Makefile) so this process can
    reach the verifier over the network instead.
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
    payload = public_evidence()
    print("deployment       :", payload["healthToken"])
    print("field family     :", ", ".join(str(prime) for prime in payload["primes"]))
    print()
    print("An order n is legal over p exactly when n divides p-1. A sample of this")
    print("deployment's family, with the orders the contract accepts in each:")
    print()
    for field in payload["labFields"]:
        orders = field["legalOrders"]
        assert isinstance(orders, list)
        rendered = ", ".join(str(order) for order in orders)
        print(f"  p = {field['prime']:<5} legal orders: {rendered}")
    print()

    example = payload["workedExample"]
    prime, order, omega = example["prime"], example["order"], example["omega"]
    coefficients = example["coefficients"]
    assert isinstance(coefficients, list)
    points, values = example["points"], example["values"]
    assert isinstance(points, list) and isinstance(values, list)

    print(f"A worked transform, the same on every deployment: p = {prime}, n = {order}")
    print(f"  f(x)           : {coefficients} (constant term first)")
    print(f"  omega          : {omega}")
    print("   i |  omega^i | f(omega^i)")
    for index, (point, value) in enumerate(zip(points, values, strict=True)):
        print(f"   {index} | {point:8d} | {value:10d}")
    print()
    print(f"  the {order} points are distinct, which is what makes this invertible.")
    print()
    print("The hidden phases use primes and orders that are not in the public tests.")
    print("Whether the omega your code picks is the right one for those is the problem.")


if __name__ == "__main__":
    main()
