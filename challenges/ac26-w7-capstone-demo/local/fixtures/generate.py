"""Seed-derived settings for the capstone, and the randomness contract they run under.

The scenario is the one Week 7's design problem ends on: several parties each hold a number,
they want the sum, and nobody will hand their number to anybody. This is the implementation.

The randomness contract below is the part worth reading twice. Privacy here is not asserted,
it is *measured* — by enumerating every possible randomness and comparing what a coalition
sees across two different honest inputs with the same sum. That enumeration only exists
because the randomness is an explicit, fixed-length tuple rather than a call to `random`.

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


#: The properties this capstone can claim. `scope` says which of them it does claim.
CLAIMABLE: tuple[str, ...] = ("correctness", "privacy", "availability", "soundness")

#: What the protocol genuinely provides, and what it does not. The two `non_goals` are the
#: honest limits of additive sharing with no authentication: a party that lies about its own
#: input is not detected (there is nothing to check it against), and a party that walks away
#: stops the protocol dead.
PROVIDED: frozenset[str] = frozenset({"correctness", "privacy"})
NOT_PROVIDED: frozenset[str] = frozenset({"soundness", "availability"})

#: Small primes, all big enough that the sum is not forced and small enough to reason about.
MODULI: tuple[int, ...] = (7, 11, 13, 17, 19, 23)


def _stream(seed: str, label: str) -> int:
    digest = hashlib.sha256(f"{seed}/{label}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _setting(seed: str, label: str, parties: int, modulus: int) -> Setting:
    inputs = tuple(
        _stream(seed, f"{label}/input/{index}") % modulus for index in range(parties)
    )
    return Setting(parties=parties, modulus=modulus, inputs=inputs)


def public_setting(seed: str) -> Setting:
    """The setting the public tests and `make inspect` walk through."""
    return _setting(seed, "public", parties=3, modulus=MODULI[_stream(seed, "public/p") % len(MODULI)])


def hidden_settings(seed: str) -> list[Setting]:
    """Settings the public tests never show: more parties, other fields, edge inputs.

    A protocol that works for three parties over one prime and nothing else fails here, which
    is the point — the public example fixes both.
    """
    settings = [
        _setting(seed, f"hidden/{index}", parties=parties, modulus=modulus)
        for index, (parties, modulus) in enumerate(
            (
                (2, MODULI[_stream(seed, "hidden/p0") % len(MODULI)]),
                (3, MODULI[_stream(seed, "hidden/p1") % len(MODULI)]),
                (4, MODULI[_stream(seed, "hidden/p2") % len(MODULI)]),
                (5, MODULI[_stream(seed, "hidden/p3") % len(MODULI)]),
            )
        )
    ]
    # Every input zero, and every input the largest residue: the two cases where an
    # implementation that forgets to reduce, or that special-cases zero, comes apart.
    modulus = MODULI[_stream(seed, "hidden/edge") % len(MODULI)]
    settings.append(Setting(parties=3, modulus=modulus, inputs=(0, 0, 0)))
    settings.append(Setting(parties=3, modulus=modulus, inputs=(modulus - 1,) * 3))
    return settings


#: Small enough that every randomness can be enumerated: 3 parties over F_5 is 5^6 = 15625
#: runs, which is the whole probability space, not a sample. Privacy is checked exactly.
TINY = Setting(parties=3, modulus=5, inputs=(1, 2, 3))


def tiny_settings() -> list[Setting]:
    """Two settings with the same output and different honest inputs.

    This pair is the privacy experiment: a coalition's view must be distributed identically
    across them. If it is not, the view depends on more than the output, and something the
    coalition should not learn is reaching it.
    """
    return [TINY, Setting(parties=3, modulus=5, inputs=(1, 0, 0))]


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
