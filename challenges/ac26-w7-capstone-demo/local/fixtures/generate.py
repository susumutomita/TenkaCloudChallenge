"""Seed-derived settings for the capstone. Verifier-side only.

The scenario is the one Week 7's design problem ends on: several parties each hold a number,
they want the sum, and nobody will hand their number to anybody. This is the implementation.

Issue 537/538 (Issue 543 option B2): this module no longer ships in the participant image (see
../Dockerfile). What it carries is the *derivation* — `hidden_settings` draws the party counts,
the fields and the inputs every checkpoint is graded on, and it shipped beside
`tests/hidden/check_capstone.py`, whose `_spec_well_formed`, `_spec_view` and `_leaks` write out
the acceptance rule for the transcript, the view and the privacy experiment in full. A
submission transcribed from the two shipped files, with no reasoning past copying, scored all
eight checkpoints, 300 of 300 points.

`public_payload` below is what the participant image reads instead of importing this module,
over the Compose-internal network (see verifier/server.py's `GET /public`, show.py, and
tests/public/test_capstone.py).

The supplied half — `Setting`, the vocabulary, the tiny settings and the randomness contract —
lives in `participant/lab.py` and is re-exported here, so `tests/hidden/check_capstone.py`,
`reference/capstone.py` and `mutation.py` keep importing it from one place. One implementation,
graded and inspected, rather than two that can drift.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Re-exported: the module lives under `participant/` because that is the image it ships in;
# it is not participant-only material to this side.
from participant.lab import (  # noqa: E402,F401 - re-export, after the sys.path insert
    CLAIMABLE,
    NOT_PROVIDED,
    PROVIDED,
    TINY,
    Setting,
    honest_sum,
    randomness_space,
    sample_randomness,
    setting_from_payload,
    tiny_settings,
)
from participant.lab import _stream  # noqa: E402 - the seed derivation below shares it

#: Small primes, all big enough that the sum is not forced and small enough to reason about.
MODULI: tuple[int, ...] = (7, 11, 13, 17, 19, 23)


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


def health_token(seed: str) -> str:
    setting = public_setting(seed)
    return hashlib.sha256(
        f"health:{seed}:{setting.parties}:{setting.modulus}".encode()
    ).hexdigest()[:16]


def public_payload(seed: str) -> dict:
    """Everything a participant may see for this deployment. Carries values, not code.

    This is the `public` label only. Every checkpoint is graded on `public_setting` *and* the
    six `hidden_settings` above — other party counts, other fields, and the two edge input
    vectors — so a protocol tuned to what travels below does not pass. What does not travel is
    `_setting` and `hidden_settings` themselves: the derivation, which is what makes those six
    unreachable rather than merely unnamed.

    The vocabulary travels because `make inspect` has always printed it. `show.py` prints
    `claimable`, `this build gives` and `and does not give` verbatim, and the starter asks the
    learner to work out *why* the missing pair is missing, not which pair it is — withholding
    it here would hide it from `show.py` and from nobody else (the same reading as
    ac26-w2-private-aggregate's shares).

    The public setting's inputs travel for the same reason: `make inspect` has always printed
    them, and the public tests hand them straight to the learner's `run` as `setting.inputs`,
    so a submission holds them at runtime by construction.
    """
    setting = public_setting(seed)
    return {
        "healthToken": health_token(seed),
        "setting": setting.as_dict(),
        "vocabulary": {
            "claimable": list(CLAIMABLE),
            "provided": sorted(PROVIDED),
            "notProvided": sorted(NOT_PROVIDED),
        },
    }
