"""`make inspect` — print the brief you are designing against, and the one it becomes.

Everything here is derived from FLAG_SEED, so what you see is yours. The brief you get is
one of six; the review variant is one of eighteen; and the hidden tests additionally use a
dozen briefs generated from the seed that exist in no file at all.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.lab import PRIMITIVES, PROPERTIES

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s `GET /public`
    serves, and the same two briefs this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It draws the whole population
    every checkpoint is graded over -- the six written briefs, their eighteen variants and the
    twelve generated from the seed -- and it shipped beside `tests/hidden/check_design.py`,
    which states the rule each of the eight checkpoints is graded on. `make inspect` now runs
    through Compose (see the Makefile) so this process can reach the verifier over the network
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
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down deployment
            # -- say which service is missing instead of printing a urllib traceback at
            # somebody trying to read their brief.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a checkout,
    # or the verifier/author Docker stage -- and never inside a built `participant` image, so
    # this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _show_brief(brief: dict) -> None:
    print(f"  id          {brief['id']}")
    print(f"  statement   {brief['statement']}")
    print("  actors")
    for actor in brief["actors"]:
        print(f"    {actor['id']:<16} {actor['role']}")
    print("  assets")
    for asset in brief["assets"]:
        derived = f"  derived from {asset['derived_from']}" if asset.get("derived_from") else ""
        print(f"    {asset['id']:<16} owner={asset['owner']}{derived}")
        print(f"      may read        {asset['known_to']}")
        print(f"      must not learn  {asset['must_not_learn']}")
        print(f"      relied on by    {asset['integrity_relied_on_by']}")
    print("  constraints")
    for key, value in brief["constraints"].items():
        print(f"    {key:<32} {value}")


def main() -> None:
    payload = public_evidence()

    print("== the vocabulary ==")
    print(f"  properties   {', '.join(PROPERTIES)}")
    print("  options")
    for name, entry in PRIMITIVES.items():
        print(f"    {name:<12} provides {', '.join(entry['provides'])}")
        print(f"    {'':<12} trusts   {', '.join(entry['trusts']) or '(nothing new)'}")
        print(f"    {'':<12} does NOT {'; '.join(entry['non_goals'])}")
    print()
    print("  These are toy characterizations, chosen so the trade-offs are visible in one")
    print("  screen. They are not production guidance, and a real deployment differs.")
    print()

    print("== your brief ==")
    _show_brief(payload["brief"])
    print()

    print("== the same brief, after one fact changes ==")
    print("  The scenario review hands you briefs like this one. Nothing about the")
    print("  requirements is restated — you re-read the facts and see what follows.")
    print()
    _show_brief(payload["reviewVariant"])
    print()
    print("  Compare the two by hand before you write any code. If your answer for the")
    print("  second is not a consequence of the first, the last checkpoint will say so.")


if __name__ == "__main__":
    main()
