"""Reference answers, derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory and
nothing on the participant path imports it. See TEMPLATE.md "Assurance scope" for
what that does and does not buy.

There is nothing clever here, and that is the point. Your row of a linear pipeline
is the pipeline applied to your row, with the public constant folded in only if the
convention names you. The desk's published total is off by exactly what its fault
did to the constant. And an expression finishes inside one party exactly when it is
degree at most one in the shared values.

The problem is not that these are hard to write down. It is that writing them down
requires believing that a sharing is a set of rows that sum, rather than a value in
disguise -- which is the fact the rest of Week 2 is built on.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    LIVE,
    TRANSFER,
    correct_row,
    correct_total,
    local_ids,
)


def row_argument(seed: str, case: str) -> str:
    return str(correct_row(seed, case))


def total_argument(seed: str, case: str) -> str:
    return str(correct_total(seed, case))


def silent_argument(seed: str, case: str) -> str:
    return ",".join(local_ids(seed, case))


def live_arguments(seed: str) -> dict[str, list[str]]:
    """The three live stages, as the argument lists their commands take."""
    return {
        "row": [row_argument(seed, LIVE)],
        "total": [total_argument(seed, LIVE)],
        "silent": [silent_argument(seed, LIVE)],
    }


def transfer_arguments(seed: str) -> list[str]:
    """`shares transfer row=... total=... silent=...`, as three argv words."""
    return [
        f"row={row_argument(seed, TRANSFER)}",
        f"total={total_argument(seed, TRANSFER)}",
        f"silent={silent_argument(seed, TRANSFER)}",
    ]
