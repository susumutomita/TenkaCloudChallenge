"""Reference answers: derived from the seed rather than stored.

Author stage only -- the `participant` image does not carry this directory, and nothing
on the participant path imports it. See TEMPLATE.md "Assurance scope" for what that does
and does not buy.

There is no cleverness here, and that is the point: the four answers are the four
readings the problem asks for, computed the same way a participant computes them. The
completion rule is the only one with any freedom in it, and any expression that agrees
with the arithmetic over the whole family is accepted -- the grading is structural, so
this particular spelling is one correct answer rather than the correct answer.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixtures.generate import (
    LIVE,
    TRANSFER,
    ledger_a,
    ledger_b,
    setting,
    target_value,
)


def recover_arguments(seed: str, name: str = LIVE) -> list[str]:
    return [str(ledger_a(seed, name).secret)]


def completion_expression(_seed: str) -> str:
    """One closed form. The visible shares already contribute `known`, so the missing
    party has to supply the difference -- brought back into the field, because `known`
    is a raw sum and is usually larger than the modulus."""
    return "(target - known) % modulus"


def complete_arguments(seed: str) -> list[str]:
    return [completion_expression(seed)]


def refresh_offsets(seed: str, name: str = LIVE) -> list[int]:
    """A zero-sharing with no zero in it: 1 for everyone, and the remainder for the last.

    `n - 1` is never 0 modulo a prime larger than `n`, so the last offset is non-zero on
    every setting this problem can draw.
    """
    cfg = setting(seed, name)
    return [1] * (cfg.n - 1) + [(-(cfg.n - 1)) % cfg.p]


def refresh_arguments(seed: str, name: str = LIVE) -> list[str]:
    return [",".join(str(offset) for offset in refresh_offsets(seed, name))]


def transfer_completion(seed: str) -> int:
    ledger = ledger_b(seed, TRANSFER)
    return (target_value(seed, TRANSFER) - ledger.known()) % ledger.p


def transfer_arguments(seed: str) -> list[str]:
    return [
        f"recover={ledger_a(seed, TRANSFER).secret}",
        f"complete={transfer_completion(seed)}",
        f"refresh={refresh_arguments(seed, TRANSFER)[0]}",
    ]
