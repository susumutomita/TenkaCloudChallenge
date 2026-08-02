"""Reference answers: derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory, and nothing
on the participant path imports it. See TEMPLATE.md "Assurance scope" for what that does
and does not buy.

There is no cleverness here, and that is the point: the five answers are the five
readings the problem asks for, computed the same way a participant computes them.
`forge` in particular is not "the witness plus p" -- it asks the panel which side of the
congruence its unsound verifier will still take, exactly as a participant does with
`review run`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    LIVE,
    PROPERTIES,
    TRANSFER,
    forged_value,
    matrix,
    panel as build_panel,
)


def reject_arguments(seed: str, name: str = LIVE) -> list[str]:
    """The edge statement's honest witness: the only in-range value it is true of."""
    return [str(build_panel(seed, name).edge.witness)]


def recover_arguments(seed: str, name: str = LIVE) -> list[str]:
    """The value the honest run used, which the leaky verifier's record determines."""
    return [str(build_panel(seed, name).main.witness)]


def forge_arguments(seed: str, name: str = LIVE) -> list[str]:
    """A solution of the congruence outside the range that the unsound verifier takes."""
    forged = forged_value(build_panel(seed, name))
    if forged is None:
        raise AssertionError(f"panel {name} of {seed!r} has no forgeable value")
    return [str(forged)]


def classification(seed: str, name: str = LIVE) -> dict[str, list[str]]:
    """For each verifier, the properties it still holds."""
    panel_ = build_panel(seed, name)
    table = matrix(panel_)
    return {
        verifier_id: [prop for prop in PROPERTIES if table[verifier_id][prop]]
        for verifier_id in panel_.ids()
    }


def classify_arguments(seed: str, name: str = LIVE) -> list[str]:
    held = classification(seed, name)
    return [
        f"{verifier_id}=" + (",".join(properties) if properties else "none")
        for verifier_id, properties in held.items()
    ]


def transfer_arguments(seed: str) -> list[str]:
    return [
        f"reject={reject_arguments(seed, TRANSFER)[0]}",
        f"recover={recover_arguments(seed, TRANSFER)[0]}",
        f"forge={forge_arguments(seed, TRANSFER)[0]}",
    ]
