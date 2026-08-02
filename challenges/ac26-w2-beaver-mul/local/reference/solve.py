"""Reference answers, derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory and
nothing on the participant path imports it. See TEMPLATE.md "Assurance scope" for
what that does and does not buy.

There is nothing clever here, and that is the point. The openings are the sums of
the broadcast rows. Your row of the product is the linear part of Beaver's identity
applied to your own rows, plus the public scalar if and only if the convention names
you. And the published number is off by exactly what the implementation did with
that scalar.

The problem is not that these are hard to write down. It is that writing them down
requires believing that `d*e` is a scalar rather than a sharing, which is a
distinction the shape of the formula does nothing to advertise.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import LIVE, TRANSFER, correct_row, opened, product


def open_argument(seed: str, case: str) -> str:
    values = opened(seed, case)
    return f"{values['d']},{values['e']}"


def row_argument(seed: str, case: str) -> str:
    return str(correct_row(seed, case))


def product_argument(seed: str, case: str) -> str:
    return str(product(seed, case))


def live_arguments(seed: str) -> dict[str, list[str]]:
    """The three live stages, as the argument lists their commands take."""
    return {
        "open": [open_argument(seed, LIVE)],
        "row": [row_argument(seed, LIVE)],
        "product": [product_argument(seed, LIVE)],
    }


def transfer_arguments(seed: str) -> list[str]:
    """`beaver transfer open=... row=... product=...`, as three argv words."""
    return [
        f"open={open_argument(seed, TRANSFER)}",
        f"row={row_argument(seed, TRANSFER)}",
        f"product={product_argument(seed, TRANSFER)}",
    ]
