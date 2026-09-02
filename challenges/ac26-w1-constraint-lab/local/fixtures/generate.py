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


# --- hidden material -----------------------------------------------------------
#
# Everything below is graded only: the participant image never carries this module
# (see ../Dockerfile), and `public_payload` deliberately builds nothing from it.

HIDDEN_LABELS = ("h0", "h1", "h2")


def hidden_circuit(seed: str, label: str) -> list[dict[str, object]]:
    """The five public constraints plus a `member` constraint on a sixth signal.

    The public circuit exercises four of the five kinds; the hidden one exercises all
    five, so an `evaluate` that never learned `member` cannot pass on the public
    example alone. The allowed set is the same one the membership gadget is graded on
    for this label.
    """
    return [
        *circuit(seed, label),
        {"id": "c5", "kind": "member", "signal": "tier", "allowed": allowed_set(seed, label)},
    ]


def hidden_honest_witness(seed: str, label: str) -> dict[str, int]:
    s = _stream(seed, f"tier:{label}")
    allowed = allowed_set(seed, label)
    witness = dict(honest_witness(seed, label))
    witness["tier"] = allowed[_pick(s, 0, 0, len(allowed) - 1)]
    return witness


def hidden_order(seed: str, label: str) -> list[int]:
    """A seed-derived permutation of the hidden circuit's positions.

    Never the identity and never its reverse: the statement promises the constraints
    arrive reordered, and a `trace` that sorts by id (ascending or descending) has to
    fail on that promise rather than pass by luck.
    """
    s = _stream(seed, f"order:{label}")
    size = len(hidden_circuit(seed, label))
    order = list(range(size))
    for index in range(size - 1, 0, -1):
        other = _pick(s, 2 * index, 0, index)
        order[index], order[other] = order[other], order[index]
    if order == sorted(order) or order == sorted(order, reverse=True):
        order = order[1:] + order[:1]
    return order


def hidden_shuffled_circuit(seed: str, label: str) -> list[dict[str, object]]:
    """The hidden circuit in the order `trace` and `first_broken` are handed it."""
    circ = hidden_circuit(seed, label)
    return [circ[index] for index in hidden_order(seed, label)]


def hidden_broken_witness(seed: str, label: str) -> dict[str, int]:
    """A witness with a break the honest one does not have. Which kind breaks depends
    on the label, so every deployment exercises all three shapes of break:

      h0  an arithmetic constraint (`gated` or `score`, as in the public case)
      h1  the `member` constraint (`tier` outside the allowed set)
      h2  the `boolean` constraint (`flag` neither 0 nor 1, with `gated` and `score`
          recomputed so that only the boolean constraint notices)

    The first violated constraint is whichever of those comes first in
    `hidden_order`; the checker derives it from the reference evaluator rather than
    from this function, so the position and the id are both order-dependent.
    """
    s = _stream(seed, f"broken:{label}")
    p = field_modulus(seed, label)
    witness = hidden_honest_witness(seed, label)
    variant = HIDDEN_LABELS.index(label) % 3 if label in HIDDEN_LABELS else 0
    if variant == 0:
        arithmetic_break, _constraint_id, _residual = _broken_case(seed, label)
        witness.update(arithmetic_break)
    elif variant == 1:
        allowed = allowed_set(seed, label)
        outside = [value for value in range(p) if value not in allowed]
        witness["tier"] = outside[_pick(s, 2, 0, len(outside) - 1)]
    else:
        flag = _pick(s, 2, 2, p - 1)
        witness["flag"] = flag
        witness["gated"] = (witness["role"] * flag) % p
        witness["score"] = (witness["gated"] + witness["bonus"]) % p
    return witness


#: Widest range the gadget is graded on. 2**6 = 64 is below every prime in PRIMES, so
#: "2**bits < p" holds for every hidden field without a per-field clamp.
RANGE_MAX_BITS = 6


def range_bits(seed: str, label: str) -> int:
    """Width of the range gadget for one hidden label: 1-2 / 3-4 / 5-6.

    Spread by label rather than drawn freely so that every deployment covers both
    ends -- the one-bit case that needs no adder chain, and the widest case where a
    per-bit doubling chain approaches the 5 x bits constraint budget.
    """
    s = _stream(seed, f"range:{label}")
    base = {"h0": 1, "h1": 3, "h2": 5}.get(label, 3)
    return min(base + s[0] % 2, RANGE_MAX_BITS)


def range_probe_values(seed: str, label: str) -> list[int]:
    """Values outside 0 .. 2**bits - 1 that the gadget must reject.

    The boundary itself, the field's largest element (the classic "-1"), the midpoint
    between them, and one seed-picked value in between.
    """
    p = field_modulus(seed, label)
    low = 2 ** range_bits(seed, label)
    s = _stream(seed, f"probe:{label}")
    return sorted({low, p - 1, (low + p - 1) // 2, _pick(s, 0, low, p - 1)})


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
