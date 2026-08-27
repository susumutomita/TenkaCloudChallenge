"""The supplied half: the opening handle, and how a sharing is put back together.

This problem hands the learner an `io` object and asks them to decide how many times to
call it. The handle itself is not what is being graded, so it ships in the participant
image and the public tests import it from here.

Issue 537/538 (Issue 543 option B2): these three names used to live in
`fixtures/generate.py`, which also carries this deployment's seed derivation -- the
settings, the secret counts and severities, the triples, and `plain_score`. That file
does not ship in the `participant` Docker stage any more (see ../Dockerfile), so the
supplied half moved here rather than leaving with it. `fixtures/generate.py` imports
these names from this module instead of restating them, so there is one `Protocol` in
the catalog and the round counting a learner sees is the round counting they are graded
by. Same shape as ac26-w5-rgsw-external's `participant/ring.py` and
ac26-w2-oblivious-transfer's `participant/ot.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def reconstruct(shares: list[int], p: int) -> int:
    """Additive sharing: the value is the sum of the shares, mod p."""
    return sum(shares) % p


class ForbiddenOpen(Exception):
    """Raised when the protocol asks to reveal something it has no business revealing."""


@dataclass
class Protocol:
    """The only way a submission is allowed to reveal anything.

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
        if not isinstance(sharings, list) or not sharings:
            raise ForbiddenOpen("an opening round must reveal at least one sharing")
        values = []
        for sharing in sharings:
            if not isinstance(sharing, list) or not sharing:
                raise ForbiddenOpen("that is not a sharing")
            self.opened.append(list(sharing))
            values.append(sum(sharing) % self.p)
        self.rounds += 1
        self.batch_sizes.append(len(sharings))
        return values
