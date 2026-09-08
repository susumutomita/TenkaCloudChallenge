"""Print this deployment's brief, vocabulary, and changed requirements."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.lab import PRIMITIVES, PROPERTIES

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """Read the same public evidence as the Workbench's Inspect action."""
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
                "The public evidence service is unavailable. "
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
        print(f"    {'':<12} assumes  {'; '.join(entry['assumptions'])}")
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
    print("  First implement classify_assets and run the public 2-by-2 classification test.")
    print("  After that first PASS, use the rules to build the remaining functions.")
    print("  For revision, rebuild the design from the changed facts instead of old answers.")


if __name__ == "__main__":
    main()
