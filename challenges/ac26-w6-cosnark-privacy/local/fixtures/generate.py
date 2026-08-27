"""Seed derivation and ground truth: the setting, the coefficients, the witness, the relation.

This module is the half that decides what a checkpoint is graded on, and it does **not** ship
in the participant image (see ../Dockerfile).

Issue 537/538 (Issue 543 option B2): until that split this file also held the supplied layer
-- the sharing runtime, the disclosure sink, the policy vocabulary and the two answers this
problem hands over -- and the whole of it shipped in one Docker stage beside
`tests/hidden/check_prover.py` and `fixtures/specimens.py`. The supplied half is in
`participant/mpc.py` now, where the learner can still read it, and what stayed here is
`setting`, `coefficients`, `witness`, `relation` and `value_catalog`: the five functions the
hidden labels `h0`..`h3` are drawn from, and therefore the five every checkpoint is actually
graded on.

`public_payload` below is what the participant image reads instead of importing this module,
over the Compose-internal network (see verifier/server.py's `GET /public`, participant/lab.py,
show.py, and tests/public/test_prover.py).

Nothing here is copied from the course's `co-snark-prove` exercise: no function names, no
coefficients, no fixtures, no skeleton. Parameters come from the seed and every convention is
written out in `participant/mpc.py`.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Re-exported so `tests/hidden/check_prover.py` and `mutation.py` keep importing the supplied
# layer from one place. The module lives under `participant/` because that is the image it
# ships in; it is not participant-only material to this side.
from participant.mpc import (  # noqa: E402,F401 - re-export, after the sys.path insert
    ALLOWED_NAMES,
    AUDIENCES,
    CHANNELS,
    CLASSES,
    FORMS,
    ORIGINS,
    PROTOCOL_CAPABILITIES,
    SHARING_ONLY_NAMES,
    AuditRuntime,
    CrossPartyRead,
    Disclosure,
    Runtime,
    Share,
    Sink,
    Triple,
    TripleMisuse,
    beaver_product,
    clean_artifact,
    field_id,
    is_sharing,
    linear_halves,
    round_id_for,
)
from participant.mpc import _pick, _stream  # noqa: E402 - the seed helpers below share them

#: Small primes, big enough that a product wraps and small enough to enumerate.
PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)

#: Coefficient shapes the hidden tests draw from, inherited from the two problems before this
#: one so the rows a learner already met still appear here.
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
    """The secret. Exists here only to be split; never reaches a specimen in the clear."""
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


# ---------------------------------------------------------------------------
# The catalog a data-classification policy is written against
# ---------------------------------------------------------------------------

#: One catalog entry per shape of value a co-SNARK prover run produces, as
#: `(origin, form, opening, audience)`. `opening` is `none`, `authorized` (the
#: multiplication's own masked value), `undeclared` (masked, but published in a round the
#: relation never declared) or `unmasked` (published in the right round with nothing hiding
#: it). The last two are the reason classification is a policy and not a lookup.
_CATALOG_KINDS = (
    ("relation", "element", "none", "everyone"),
    ("relation", "metadata", "none", "everyone"),
    ("runtime", "metadata", "none", "everyone"),
    ("witness", "share", "none", "party"),
    ("triple", "share", "none", "party"),
    ("witness", "element", "authorized", "everyone"),
    ("witness", "element", "authorized", "everyone"),
    ("triple", "element", "none", "party"),
    ("witness", "element", "none", "party"),
    ("witness", "element", "undeclared", "everyone"),
    ("witness", "element", "unmasked", "everyone"),
    ("witness", "sharing", "none", "participant"),
    ("witness", "sharing", "none", "participant"),
    ("triple", "sharing", "none", "party"),
    ("witness", "element", "none", "verifier"),
    ("witness", "element", "none", "verifier"),
)


def value_catalog(seed: str, label: str, row: dict) -> tuple[dict, ...]:
    """Every kind of value one run produces, in a seed-derived order and under opaque ids.

    An entry describes a value without naming it, so the answer comes from the descriptors
    rather than from recognizing `w` or `x`:

    ```text
    id        opaque, and re-drawn per seed
    origin    relation / witness / triple / runtime
    form      metadata / element / share / sharing
    opened    None, or {"roundId", "maskedBy"} -- the same shape `openings()` records use
    audience  everyone / participant / party / verifier
    ```
    """
    declared = round_id_for(row)
    mask_id = f"T-{label}x#0"
    openings = {
        "none": None,
        "authorized": {"roundId": declared, "maskedBy": (mask_id,)},
        "undeclared": {"roundId": f"{row['relationId']}:recheck", "maskedBy": (mask_id,)},
        "unmasked": {"roundId": declared, "maskedBy": ()},
    }
    drawn = [
        {
            "origin": origin,
            "form": form,
            "opened": None if openings[opening] is None else dict(openings[opening]),
            "audience": audience,
        }
        for origin, form, opening, audience in _CATALOG_KINDS
    ]
    s = _stream(seed, f"catalog:{label}")
    order = sorted(range(len(drawn)), key=lambda index: (s[(3 * index) % 500], index))
    # The id is assigned after the shuffle, so it says nothing about which kind this is.
    return tuple(
        {"id": f"v{position:02d}", **drawn[index]} for position, index in enumerate(order)
    )


def health_token(seed: str) -> str:
    cfg = setting(seed)
    return hashlib.sha256(f"health:{seed}:{cfg['settingId']}".encode()).hexdigest()[:16]


def public_payload(seed: str) -> dict:
    """Everything a participant may see for this deployment. Carries values, not code.

    This is the `public` label only. Every checkpoint is graded on `h0`, `h1`, `h2` or `h3`
    (see tests/hidden/check_prover.py), each of which draws a different prime, party count and
    witness length from the same seed, and `transfer` grades on a seed derived from this one
    against provers that are not among the eight -- so none of the five derivations above is
    answerable from what travels below.

    What travels is exactly what `make inspect` has always printed and what the public tests
    have always built their bench from: the setting, the four coefficient shapes of the public
    row, the public label's witness, the catalog `classify` is demonstrated on, and the health
    token.

    The witness is the one entry that deserves an argument rather than an assertion. It
    travels for the same reason ac26-w2-private-aggregate's shares do: `Scenario` deals it
    into the sharing the public tests hand straight to `prover.private_prover`, and every
    specimen `make inspect P=...` runs is handed the same halves, so a participant process
    holds it at runtime by construction and withholding it here would hide it from the bench
    and from nobody else. It is the `public` label's witness, which no checkpoint is graded on.
    `show.py` still prints no witness value and no share value, exactly as before -- the ids
    are what it prints, and the ids are what it printed before this split.

    The catalogs travel keyed by relation id rather than by shape, because that is the key
    `participant/lab.py` has in hand when a test asks for the catalog of a row it is holding.

    What does not travel is `setting`, `coefficients`, `witness`, `relation` and
    `value_catalog` themselves -- the derivations, which is what makes the hidden labels
    unreachable rather than merely unnamed.
    """
    cfg = setting(seed)
    rows = {
        shape: {
            key: list(value) if isinstance(value, tuple) else value
            for key, value in relation(seed, "public", cfg, shape).items()
        }
        for shape in SHAPES
    }
    return {
        "healthToken": health_token(seed),
        "shapes": list(SHAPES),
        "setting": dict(cfg),
        "witness": list(witness(seed, "public", cfg)),
        "rows": rows,
        "catalogs": {
            row["relationId"]: [
                {
                    "id": entry["id"],
                    "origin": entry["origin"],
                    "form": entry["form"],
                    "opened": None
                    if entry["opened"] is None
                    else {
                        "roundId": entry["opened"]["roundId"],
                        "maskedBy": list(entry["opened"]["maskedBy"]),
                    },
                    "audience": entry["audience"],
                }
                for entry in value_catalog(seed, "public", row)
            ]
            for row in rows.values()
        },
    }
