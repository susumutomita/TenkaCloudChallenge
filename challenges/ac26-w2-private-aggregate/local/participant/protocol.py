"""Trusted record of the modeled opening channel and additive reconstruction.

The checker and public-test parent own Protocol. Learner code receives a remote
open_batch handle; it cannot change this object's recorded rounds or sharings.
This model observes that channel, not all possible Python information flows.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def reconstruct(shares: list[int], p: int) -> int:
    """Additive sharing: the value is the sum of the shares, mod p."""
    return sum(shares) % p


class ForbiddenOpen(ValueError):
    """Raised when the protocol asks to reveal something it has no business revealing."""


@dataclass
class Protocol:
    """Record what a submission reveals through the modeled opening channel.

    `open_batch` reveals several sharings at once and counts as **one** round. That is
    the entire cost model: a submission that calls it once per multiplication pays `k`
    rounds for work that fits in one, and the count is measured rather than claimed.

    Every opened sharing is recorded, so the privacy checkpoint audits what a run
    actually revealed rather than what it says it revealed.
    """

    p: int
    rounds: int = 0
    opened: list[list[int]] = field(default_factory=list)
    batch_sizes: list[int] = field(default_factory=list)

    def open_batch(self, sharings: list[list[int]]) -> list[int]:
        if type(sharings) not in (list, tuple) or not sharings:
            raise ForbiddenOpen("an opening round must reveal at least one sharing")
        values = []
        for sharing in sharings:
            if type(sharing) not in (list, tuple) or not sharing or any(type(v) is not int or not 0 <= v < self.p for v in sharing):
                raise ForbiddenOpen("that is not a sharing")
            self.opened.append(list(sharing))
            values.append(sum(sharing) % self.p)
        self.rounds += 1
        self.batch_sizes.append(len(sharings))
        return values
