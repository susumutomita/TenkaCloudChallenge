"""`make inspect` — the machine, its trace, and the domain the trace maps onto."""

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
    `tests/hidden/check_air.py` -- which states the residual count `starter/air.py` asks
    the learner to work out, the row a transition failure is attributed to, and every
    condition an underconstrained witness is accepted on -- and because its own
    `honest_trace` is, by its docstring there, the reference answer for the trace
    checkpoint. `make inspect` now runs through Compose (see the Makefile) so this process
    can reach the verifier over the network instead.
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
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down
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
    cfg = payload["setting"]
    assert isinstance(cfg, dict)
    trace = payload["trace"]
    points = payload["domain"]
    assert isinstance(trace, list) and isinstance(points, list)
    start_a, start_b = cfg["start"]

    print("health token :", payload["healthToken"])
    print(f"field        : F_{cfg['p']}")
    print(f"steps        : {cfg['steps']}")
    print(f"weight       : {cfg['weight']}")
    print(f"start        : a0 = {start_a}, b0 = {start_b}")
    print()
    print("  a_{i+1} = a_i + b_i")
    print(f"  b_{{i+1}} = b_i + {cfg['weight']}*a_i        (mod {cfg['p']})")
    print()
    print("  row   a     b     domain point")
    for index, (a, b) in enumerate(trace):
        print(f"  {index:<5} {a:<5} {b:<5} {points[index]}")
    print()
    print(f"The domain is the {cfg['steps']} powers of a root of unity, in trace order.")
    print(f"Row i sits at point {points[1]}^i, so consecutive rows are consecutive points")
    print("and the transition constraint becomes a relation between a polynomial at x")
    print("and the same polynomial at the next point.")
    print()
    print("There are two kinds of constraint here and they do different jobs.")
    print("Count how many transition residuals this trace has before you write them.")


if __name__ == "__main__":
    main()
