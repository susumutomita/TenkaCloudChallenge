"""`make inspect` — the ring, the encoding points, and where a message stops surviving.

Everything is derived from FLAG_SEED, so what you see is yours. The number line is the
supporting view; the table under it is the one to reason from.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WIDTH = 60


def _public_payload() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s
    `GET /public` serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It implements `encode`,
    `centered`, `decode`, `success_interval` and `first_failure` under the exact five
    names `starter/encoding.py`'s own stubs ask the learner to write, so importing it
    here handed over working implementations for four of the seven checkpoints. `make
    inspect` now runs through Compose (see the Makefile) so this process can reach the
    verifier over the network instead.
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


def _line(payload: dict) -> str:
    """A row of the ring, with an X at each encoding point."""
    q = payload["params"]["q"]
    cells = ["."] * min(q, WIDTH)
    for entry in payload["points"]:
        cells[entry["encode"] * len(cells) // q] = "X"
    return "".join(cells)


def main() -> None:
    payload = _public_payload()
    par = payload["params"]
    p, delta, q = par["p"], par["delta"], par["q"]
    low, high = payload["successInterval"]["low"], payload["successInterval"]["high"]

    print("health token :", payload["healthToken"])
    print()
    print(f"  p (messages)      {p}")
    print(f"  delta (scaling)   {delta}   ({'even' if delta % 2 == 0 else 'odd'})")
    print(f"  q = p * delta     {q}")
    print()
    print(f"  ring [0, {q}), one cell per {max(1, q // WIDTH)}:")
    print(f"  {_line(payload)}")
    print("  X = an encoding point. The gaps between them are all the room there is.")
    print()

    print("  m     encode(m)   centered      decodes back to")
    for entry in payload["points"]:
        print(
            f"  {entry['m']:<5} {entry['encode']:<11} "
            f"{entry['centered']:<13} {entry['decode']}"
        )
    print()

    print(f"  tolerated noise: {low} .. {high}   (width {high - low + 1}, and delta is {delta})")
    if low != -high:
        print("  Note that it is not symmetric. Work out which end lost a point, and to what.")
    print()

    # One message walked across its upper boundary, so the flip is visible rather than
    # asserted. Which message is seed-derived; the two at the ends of the space behave
    # differently from the rest and finding that out is part of the problem.
    walk = payload["walk"]
    print(f"  message {walk['subject']}, walked across the upper boundary:")
    print("    noise   value    decodes to")
    for step in walk["steps"]:
        marker = "  <- still right" if step["decode"] == walk["subject"] else "  <- wrong now"
        print(f"    {step['noise']:<7} {step['value']:<8} {step['decode']}{marker}")
    print()

    print("  parameter sets that must be rejected:")
    for invalid in payload["invalidParams"]:
        print(
            f"    p={invalid['p']:<4} delta={invalid['delta']:<5} "
            f"q={invalid['q']:<5} {invalid['reason']}"
        )
    print()
    print("None of this is secure. p and q are small enough to enumerate by hand, which is")
    print("the only reason the boundary is visible at all.")


if __name__ == "__main__":
    main()
