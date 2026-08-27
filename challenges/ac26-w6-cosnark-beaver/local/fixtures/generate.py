"""Seed derivation and ground truth: the setting, the coefficients, the witness, the relation.

This module is the half that decides what a checkpoint is graded on, and it does **not** ship
in the participant image (see ../Dockerfile).

Issue 537/538 (Issue 543 option B2): until that split this file also held the supplied sharing
layer -- shares, triples, the instrumented runtime and `linear_halves` -- and the whole of it
shipped in one Docker stage beside `tests/hidden/check_prover.py`. The supplied half is in
`participant/mpc.py` now, where the learner can still read it, and what stayed here is
`setting`, `coefficients`, `witness` and `relation`: the four functions the hidden labels
`h0`..`h3` are drawn from, and therefore the four every checkpoint is actually graded on.

`public_payload` below is what the participant image reads instead of importing this module,
over the Compose-internal network (see verifier/server.py's `GET /public`, show.py, and
tests/public/test_prover.py).

Nothing here is copied from the course's `co-snark-prove` exercise: no function names, no
coefficients, no fixtures, no skeleton. Parameters come from the seed and every convention is
written out in `participant/mpc.py`.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Re-exported so `tests/hidden/check_prover.py`, `reference/prover.py` and `mutation.py` keep
# importing the supplied layer from one place. The module lives under `participant/` because
# that is the image it ships in; it is not participant-only material to this side.
from participant.mpc import (  # noqa: E402,F401 - re-export, after the sys.path insert
    CrossPartyRead,
    ParticipantRuntime,
    Runtime,
    Share,
    Triple,
    TripleMisuse,
    field_id,
    linear_halves,
)
from participant.mpc import _pick, _stream  # noqa: E402 - the seed helpers below share them

#: Small primes, big enough that a product wraps and small enough to enumerate.
PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)

#: Coefficient shapes the hidden tests draw from, inherited from the linear problem so the
#: two rows a learner already met still appear here.
SHAPES = ("dense", "sparse", "signed", "unit")

def setting(seed: str, label: str = "public") -> dict:
    """Field, party count and witness length. All three change between checkpoints."""
    s = _stream(seed, f"setting:{label}")
    prime = PRIMES[s[0] % len(PRIMES)]
    parties = _pick(s, 2, 2, 5)
    width = _pick(s, 4, 3, 8)
    return {
        "p": prime,
        "parties": parties,
        "width": width,
        "fieldId": field_id(prime),
        "settingId": f"F{prime}-P{parties}-W{width}",
    }


def coefficients(seed: str, label: str, setting: dict, shape: str = "dense") -> tuple[int, ...]:
    """A public coefficient vector of the requested shape."""
    s = _stream(seed, f"coeff:{label}:{shape}")
    prime, width = setting["p"], setting["width"]
    if shape == "unit":
        hot = _pick(s, 0, 0, width - 1)
        return tuple(1 if j == hot else 0 for j in range(width))
    if shape == "sparse":
        drawn = [
            _pick(s, 2 * j, 0, prime - 1) if _pick(s, 2 * j + 40, 0, 3) == 0 else 0
            for j in range(width)
        ]
        if not any(drawn):
            drawn[_pick(s, 90, 0, width - 1)] = _pick(s, 92, 1, prime - 1)
        return tuple(drawn)
    if shape == "signed":
        return tuple(_pick(s, 2 * j, -(prime // 2), prime // 2) for j in range(width))
    return tuple(_pick(s, 2 * j, 0, prime - 1) for j in range(width))


def witness(seed: str, label: str, setting: dict) -> tuple[int, ...]:
    """The secret. Exists here only to be split; never reaches the participant module."""
    s = _stream(seed, f"witness:{label}")
    return tuple(_pick(s, 2 * j, 0, setting["p"] - 1) for j in range(setting["width"]))


def relation(seed: str, label: str, setting: dict, shape: str = "dense") -> dict:
    """The public half of one R1CS-shaped row: two coefficient vectors and the field."""
    return {
        "a": tuple(c % setting["p"] for c in coefficients(seed, f"{label}:a", setting, shape)),
        "b": tuple(c % setting["p"] for c in coefficients(seed, f"{label}:b", setting, shape)),
        "relationId": f"R-{label}-{shape}",
        "fieldId": setting["fieldId"],
        "p": setting["p"],
        "width": setting["width"],
        "parties": setting["parties"],
    }


def dot(coefficient_vector, values, prime: int) -> int:
    """`sum_j c_j * v_j mod p`. The plain-reference answer, computed where the secret is."""
    return sum(c * v for c, v in zip(coefficient_vector, values)) % prime


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['settingId']}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict:
    """Everything a participant may see for this deployment. Carries values, not code.

    This is the `public` label only. Every checkpoint is graded on `h0`, `h1`, `h2` and `h3`
    (see tests/hidden/check_prover.py), each of which draws a different prime, party count and
    witness length from the same seed, and `transfer` grades on a seed derived from this one --
    so none of the four functions above is answerable from what travels below.

    What travels is exactly what `make inspect` has always printed and what the public tests
    have always built their runtime from: the setting, the four coefficient shapes of the
    public row, and the public label's witness. The witness is here for the same reason
    ac26-w2-private-aggregate's shares are: `linear_halves` splits it into the `[A]` and `[B]`
    the public tests hand straight to `prover.prove_product`, so a submission holds it at
    runtime by construction and withholding it would hide it from the tests and from nobody
    else. `show.py` still prints no witness or share value, exactly as before.

    What does not travel is `setting`, `coefficients`, `witness` and `relation` themselves --
    the derivations, which is what makes the hidden labels unreachable rather than merely
    unnamed.
    """
    cfg = setting(seed)
    return {
        "healthToken": health_token(seed),
        "shapes": list(SHAPES),
        "setting": dict(cfg),
        "witness": list(witness(seed, "public", cfg)),
        "rows": {
            shape: {
                key: list(value) if isinstance(value, tuple) else value
                for key, value in relation(seed, "public", cfg, shape).items()
            }
            for shape in SHAPES
        },
    }
