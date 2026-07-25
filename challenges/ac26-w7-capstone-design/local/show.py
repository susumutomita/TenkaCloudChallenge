"""`make inspect` — print the brief you are designing against, and the one it becomes.

Everything here is derived from FLAG_SEED, so what you see is yours. The brief you get is
one of six; the review variant is one of eighteen; and the hidden tests additionally use a
dozen briefs generated from the seed that exist in no file at all.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import PRIMITIVES, PROPERTIES, public_brief, review_variant

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


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
    _show_brief(public_brief(SEED))
    print()

    print("== the same brief, after one fact changes ==")
    print("  The scenario review hands you briefs like this one. Nothing about the")
    print("  requirements is restated — you re-read the facts and see what follows.")
    print()
    _show_brief(review_variant(SEED))
    print()
    print("  Compare the two by hand before you write any code. If your answer for the")
    print("  second is not a consequence of the first, the last checkpoint will say so.")


if __name__ == "__main__":
    main()
