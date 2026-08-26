"""`make inspect` — your moduli, and a worked extended-Euclid trace.

    make inspect              your fixtures and a trace for a default value
    make inspect A=17 P=101   the trace for any pair you like

The trace is here to make the algorithm legible. It is emphatically not a
constant-time implementation: it branches on the values and its running time depends
on them, which is fine for learning arithmetic and disqualifying for handling a real
secret key.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload(a: int, modulus: int) -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It implements `egcd`
    under the exact name `starter/field.py`'s own stub asks the learner to write, and
    `egcd_rows` is the row-for-row trace its `egcd_trace` stub asks for, so importing it
    here handed over the `egcd-trace` checkpoint outright -- 35 of this problem's 200
    points, measured. `make inspect` now runs through Compose (see the Makefile) so this
    process can reach the verifier over the network instead.

    `a` and `modulus` travel with the request because `make inspect A=17 P=101` traces
    whatever pair the learner names; a zero means "this deployment's default", exactly
    as it did when the default was computed here.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        query = urlencode({"a": a, "modulus": modulus})
        separator = "&" if "?" in verifier_public_url else "?"
        try:
            with urlopen(f"{verifier_public_url}{separator}{query}", timeout=10) as response:  # noqa: S310
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

    return public_payload(SEED, a, modulus)


def main(argv: list[str]) -> None:
    requested_a = int(os.environ.get("A") or (argv[0] if argv else 0))
    requested_modulus = int(os.environ.get("P") or (argv[1] if len(argv) > 1 else 0))
    payload = _public_payload(requested_a, requested_modulus)

    p = payload["primeModulus"]
    n = payload["compositeModulus"]
    trace = payload["trace"]
    a, modulus = trace["a"], trace["modulus"]

    print("health token     :", payload["healthToken"])
    print("prime modulus    :", p)
    print(
        "composite modulus:",
        n,
        f"(smallest non-invertible element: {payload['smallestNonInvertible']})",
    )
    print()
    print(f"extended Euclid for a = {a}, modulus = {modulus}")
    print(f"  normalized a   : {trace['normalized']}")
    print("   step |     q |     r |     s |     t")
    for index, row in enumerate(trace["rows"]):
        print(f"   {index:4d} | {row['q']:5d} | {row['r']:5d} | {row['s']:5d} | {row['t']:5d}")
    print(f"  gcd            : {trace['gcd']}")
    if trace["gcd"] == 1:
        print(f"  inverse         : {trace['inverse']}")
        print(f"  verification    : {trace['normalized']} * {trace['inverse']} mod {modulus}"
              f" = {trace['verification']}")
    else:
        print(f"  no inverse      : gcd is {trace['gcd']}, not 1")
    print()
    print("This trace branches on its inputs and its running time depends on them.")
    print("It is for reading the algorithm, not for handling a real key.")


if __name__ == "__main__":
    main(sys.argv[1:])
