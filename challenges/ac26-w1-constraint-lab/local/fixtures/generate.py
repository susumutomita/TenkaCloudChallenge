"""Circuits, witnesses and fields, all derived from the per-deploy FLAG_SEED.

A circuit here is a list of constraints. A constraint is a claim that some
expression over the signals equals zero in the field. A witness assigns a value to
every signal. "The witness satisfies the circuit" means every residual is zero —
that is the whole idea the learner is here to internalise.

Constraint kinds, each a dict so it can cross the /verify boundary as JSON:
  mul      left * right - out
  add      left + right - out
  const    signal - value
  boolean  signal * (signal - 1)
  member   product over allowed of (signal - a)
"""

from __future__ import annotations

import hashlib

# Small primes: the learner must be able to check any residual by hand.
PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def field_modulus(seed: str, label: str = "public") -> int:
    return PRIMES[_stream(seed, f"field:{label}")[0] % len(PRIMES)]


def allowed_set(seed: str, label: str = "public") -> list[int]:
    """The membership gadget's allowed values. Size 1-5, per the issue."""
    s = _stream(seed, f"allowed:{label}")
    p = field_modulus(seed, label)
    size = _pick(s, 0, 1, 5)
    values: list[int] = []
    index = 2
    while len(values) < size:
        candidate = _pick(s, index, 0, p - 1)
        if candidate not in values:
            values.append(candidate)
        index += 2
    return sorted(values)


def circuit(seed: str, label: str = "public") -> list[dict[str, object]]:
    """A small access-policy circuit: two multiplications, an addition, a boolean flag.

    Deliberately not a copy of any course exercise — it is the smallest shape that
    still has a signal whose constraint can be dropped without the others noticing.
    """
    s = _stream(seed, f"circuit:{label}")
    p = field_modulus(seed, label)
    return [
        {"id": "c0", "kind": "const", "signal": "role", "value": _pick(s, 0, 1, p - 1)},
        {"id": "c1", "kind": "boolean", "signal": "flag"},
        {"id": "c2", "kind": "mul", "left": "role", "right": "flag", "out": "gated"},
        {"id": "c3", "kind": "add", "left": "gated", "right": "bonus", "out": "score"},
        {"id": "c4", "kind": "const", "signal": "bonus", "value": _pick(s, 4, 0, p - 1)},
    ]


def honest_witness(seed: str, label: str = "public") -> dict[str, int]:
    s = _stream(seed, f"witness:{label}")
    p = field_modulus(seed, label)
    circ = circuit(seed, label)
    role = int(circ[0]["value"])  # type: ignore[arg-type]
    bonus = int(circ[4]["value"])  # type: ignore[arg-type]
    flag = _pick(s, 0, 0, 1)
    gated = (role * flag) % p
    return {
        "role": role,
        "flag": flag,
        "gated": gated,
        "bonus": bonus,
        "score": (gated + bonus) % p,
    }


def _broken_case(seed: str, label: str) -> tuple[dict[str, int], str, int]:
    """Build the broken witness and the first non-zero residual it produces."""

    s = _stream(seed, f"broken:{label}")
    p = field_modulus(seed, label)
    witness = dict(honest_witness(seed, label))
    if s[0] % 2 == 0:
        delta = _pick(s, 2, 1, p - 1)
        witness["gated"] = (witness["gated"] + delta) % p
        # gated feeds c3 too, but c2 comes first in the list order.
        return witness, "c2", (-delta) % p
    delta = _pick(s, 4, 1, p - 1)
    witness["score"] = (witness["score"] + delta) % p
    return witness, "c3", (-delta) % p


def broken_witness(seed: str, label: str = "public") -> tuple[dict[str, int], str]:
    """A witness with exactly one first violation. Returns (witness, first broken id).

    The break is placed at c2 or c3 — never at c0, so the answer is never just
    "the first constraint in the list".
    """
    witness, constraint_id, _residual = _broken_case(seed, label)
    return witness, constraint_id


def broken_diagnosis(seed: str, label: str = "public") -> dict[str, object]:
    """The trace row the manual checkpoint asks the learner to identify."""
    _witness, constraint_id, residual = _broken_case(seed, label)
    return {"constraintId": constraint_id, "residual": residual}


def health_token(seed: str) -> str:
    return hashlib.sha256(
        f"health:{seed}:{field_modulus(seed)}".encode()
    ).hexdigest()[:16]


def public_payload(seed: str) -> dict[str, object]:
    """Everything a participant may see for this deployment. Contains no answer.

    The single source `show.py`, `verifier/server.py`'s `GET /public`, and the Portal's
    `/api/inspect` all build their payload from. `broken_witness`'s constraint id and
    `broken_diagnosis` are deliberately absent -- they are the answer to `first-broken`,
    not what a learner is shown to work from.

    Issue 543/537: `fixtures/` -- this module -- does not ship in the participant Docker
    stage at all (see ../Dockerfile). `participant/server.py` and `show.py` fetch this
    payload from the verifier at runtime instead of building it locally.
    """
    witness, _expected = broken_witness(seed)
    return {
        "field": {
            "p": field_modulus(seed),
            "allowedSet": allowed_set(seed),
        },
        "circuit": circuit(seed),
        "honestWitness": honest_witness(seed),
        "brokenWitness": witness,
        "healthToken": health_token(seed),
    }
