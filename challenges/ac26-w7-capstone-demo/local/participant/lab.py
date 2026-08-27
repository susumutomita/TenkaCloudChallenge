"""The supplied half of the capstone: the setting object, the vocabulary, and the randomness
contract that makes privacy measurable.

Nothing here is graded. It is the machinery `starter/capstone.py` is written against — the
learner builds the protocol, and this module is what they build it *on*. `show.py`, the public
tests, `starter/capstone.py` and the submission all import it, so it ships in the participant
image (see ../Dockerfile).

Issue 537/538 (Issue 543 option B2): this used to live in `fixtures/generate.py`, which also
carried the seed derivation every hidden label is drawn from, and shipped in the single Docker
stage a learner's own `make build` produced — beside `tests/hidden/check_capstone.py`, whose
`_spec_well_formed`, `_spec_view` and `_leaks` are the acceptance rule for the transcript, the
view and the privacy experiment written out in full. `fixtures/generate.py` re-exports this
module so the hidden checker, the reference and the mutation suite keep importing the supplied
layer from one place: one implementation, graded and inspected, rather than two that can drift.

## The randomness contract

`run` receives its randomness as an explicit tuple, never by calling `random`. Privacy here is
not asserted, it is *measured* — by enumerating every possible randomness and comparing what a
coalition sees across two different honest inputs with the same sum. That enumeration only
exists because the randomness is an explicit, fixed-length tuple.

Toy warning: the moduli are small enough to enumerate, which means they are far too small to
be secure. That is the trade — observability, not security. Nothing here is production
guidance.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from itertools import product
from typing import Iterator


@dataclass(frozen=True)
class Setting:
    """One run's parameters: who is playing, over what field, with what inputs."""

    parties: int
    modulus: int
    inputs: tuple[int, ...]

    @property
    def randomness_length(self) -> int:
        """How many field elements one run consumes.

        Each party needs `parties - 1` random values to split its input; the last share is
        whatever makes the parts add back up, so it is not drawn.
        """
        return self.parties * (self.parties - 1)

    def slice_for(self, party: int) -> tuple[int, int]:
        """The half-open range of the randomness tuple that this party draws from."""
        width = self.parties - 1
        return party * width, (party + 1) * width

    def as_dict(self) -> dict[str, object]:
        return {"parties": self.parties, "modulus": self.modulus, "inputs": list(self.inputs)}


def setting_from_payload(entry: dict) -> Setting:
    """Rebuild a `Setting` from the values `GET /public` serves.

    The inverse of `as_dict`. The participant image has no seed derivation any more, so this
    is how `show.py` and the public tests get this deployment's setting.
    """
    return Setting(
        parties=int(entry["parties"]),
        modulus=int(entry["modulus"]),
        inputs=tuple(int(value) for value in entry["inputs"]),
    )


#: The properties this capstone can claim. `scope` says which of them it does claim.
CLAIMABLE: tuple[str, ...] = ("correctness", "privacy", "availability", "soundness")

#: What the protocol genuinely provides, and what it does not. The two `non_goals` are the
#: honest limits of additive sharing with no authentication: a party that lies about its own
#: input is not detected (there is nothing to check it against), and a party that walks away
#: stops the protocol dead.
#:
#: These two sets are participant surface on purpose — `make inspect` has always printed both,
#: and the starter tells the learner to work out *why* the second pair is missing rather than
#: which pair it is. They stay on this side of the split for that reason.
PROVIDED: frozenset[str] = frozenset({"correctness", "privacy"})
NOT_PROVIDED: frozenset[str] = frozenset({"soundness", "availability"})


def _stream(seed: str, label: str) -> int:
    digest = hashlib.sha256(f"{seed}/{label}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


#: Small enough that every randomness can be enumerated: 3 parties over F_3 is 3^6 = 729
#: runs, which is the whole probability space, not a sample. Privacy is checked exactly.
#:
#: The field is this small for a reason that is not cryptographic. `detects` runs the whole
#: enumeration once per candidate protocol, and the hidden suite hands it ten of them across
#: three coalitions and two settings, so the space is multiplied by sixty before anything
#: else happens. At F_5 that is 937,500 protocol runs and the catalog's ten-minute CI budget
#: is gone; at F_3 it is 43,740. The experiment is exactly as exact either way — the whole
#: space is the whole space.
#:
#: The sum is deliberately not zero. At a sum of zero, a transcript with every value doubled
#: still totals the same thing, so the consistency check that catches a faked transcript
#: stops firing — a whole class of breakage would become invisible because of the fixture
#: rather than because of the protocol.
TINY = Setting(parties=3, modulus=3, inputs=(1, 2, 1))


def tiny_settings() -> list[Setting]:
    """Two settings with the same output and different honest inputs.

    This pair is the privacy experiment: a coalition's view must be distributed identically
    across them. If it is not, the view depends on more than the output, and something the
    coalition should not learn is reaching it.

    Party 0 holds the same input in both, so it is the coalition whose view is compared; what
    moves is what the *honest* parties hold, with the sum held fixed.
    """
    return [TINY, Setting(parties=3, modulus=3, inputs=(1, 0, 0))]


def randomness_space(setting: Setting) -> Iterator[tuple[int, ...]]:
    """Every randomness tuple this setting admits, in a fixed order.

    Only tractable for `tiny_settings`; the hidden tests never enumerate a large field.
    """
    return product(range(setting.modulus), repeat=setting.randomness_length)


def sample_randomness(seed: str, setting: Setting, label: str = "run") -> tuple[int, ...]:
    """One reproducible randomness tuple, for the runs that are not enumerated."""
    return tuple(
        _stream(seed, f"{label}/{index}") % setting.modulus
        for index in range(setting.randomness_length)
    )


def honest_sum(setting: Setting) -> int:
    """What the protocol is supposed to produce."""
    return sum(setting.inputs) % setting.modulus
