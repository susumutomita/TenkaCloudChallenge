"""Two circuits, two failing witnesses and two fields, all derived from FLAG_SEED.

A circuit here is a list of constraints. A constraint is a claim that some
expression over the signals is zero in the field. A witness assigns a value to
every signal. "The witness satisfies the circuit" means every residual is zero --
that is the whole idea the learner is here to internalise, and the audit tool they
are finishing is the thing that makes those residuals visible.

Two cases, because one is not enough to tell understanding from memorisation:

    live      the deployment's own circuit. Four constraint kinds, no membership
              constraint -- the team has not written that one yet, which is what
              the `admit` stage is about.

    transfer  a second circuit, handed over only after the first two stages are
              cleared. Different prime, different signals, different constraint
              order, one more constraint, and a `member` constraint carrying the
              gadget the learner just constructed. Its failing witness always
              leaves either the `member` or the `boolean` residual non-zero, so
              answering it means evaluating the new kinds rather than reusing the
              five numbers from the first case.

Constraint kinds, each a dict so it renders as JSON in the terminal:
  const    signal - value
  boolean  signal * (signal - 1)
  mul      left * right - out
  add      left + right - out
  member   product over the allowed values of (signal - a)
"""

from __future__ import annotations

import hashlib

#: Small primes: every residual has to be checkable by hand, on paper, in the
#: terminal the problem is played from.
PRIMES = (97, 101, 103, 107, 109, 113, 127, 131, 137, 139)

LIVE = "live"
TRANSFER = "transfer"
CASES = (LIVE, TRANSFER)

#: What each constraint kind means, as the residual that has to come out zero.
#: `audit show` prints only the rows for the kinds present in the circuit it is
#: printing -- it is the language reference for reading a circuit at all, not a
#: hint. `member` is deliberately absent from the live case: constructing that
#: residual is a stage, so it is not printed until the transfer circuit needs it.
KIND_RESIDUALS = {
    "const": "signal - value",
    "boolean": "signal * (signal - 1)",
    "mul": "left * right - out",
    "add": "left + right - out",
    "member": "(signal - a1) * (signal - a2) * ...  one factor per allowed value",
}

SIGNALS = {
    LIVE: ("role", "flag", "gated", "bonus", "score"),
    TRANSFER: ("tier", "active", "weight", "quota", "total", "billed"),
}

#: Which signal the failing witness corrupts. Every shape leaves at least two
#: residuals non-zero -- a single non-zero entry would make the whole trace
#: guessable, since the other four are visibly zero -- and none of them breaks the
#: first constraint in the list, so "the first one" is never right by accident.
BREAKS = {
    LIVE: ("flag", "gated", "bonus"),
    #: Both of these leave `member` or `boolean` non-zero. That is the property
    #: that makes the transfer stage a transfer rather than a second helping of
    #: the first one; mutation.py asserts it across seeds.
    TRANSFER: ("tier", "active"),
}

#: The membership gadget's allowed set. Two values minimum: with one, "more
#: allowed values means more factors" is not a lesson, it is a coincidence.
ALLOWED_SIZES = {LIVE: (2, 5), TRANSFER: (2, 4)}


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 128:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i] * 256 + s[i + 1]) % (high - low + 1))


def field_modulus(seed: str, case: str = LIVE) -> int:
    """The prime this case works in. The transfer case never reuses the live one."""
    s = _stream(seed, f"field:{case}")
    if case == LIVE:
        return PRIMES[s[0] % len(PRIMES)]
    others = tuple(p for p in PRIMES if p != field_modulus(seed, LIVE))
    return others[s[0] % len(others)]


def allowed_set(seed: str, case: str = LIVE) -> list[int]:
    """The licensed values of the `tier` signal, for this case's membership gadget."""
    s = _stream(seed, f"allowed:{case}")
    p = field_modulus(seed, case)
    low, high = ALLOWED_SIZES[case]
    size = _pick(s, 0, low, high)
    # The transfer case's `tier` is one of these and multiplies another signal, so a
    # zero there would silently satisfy a constraint that is supposed to break.
    smallest = 1 if case == TRANSFER else 0
    values: list[int] = []
    index = 2
    while len(values) < size:
        candidate = _pick(s, index, smallest, p - 1)
        if candidate not in values:
            values.append(candidate)
        index += 2
    return sorted(values)


def circuit(seed: str, case: str = LIVE) -> list[dict[str, object]]:
    """This case's constraints, in the order the trace has to report them.

    Neither shape is a copy of any course exercise. The live one is the smallest
    circuit that still has a signal whose only binding is one constraint; the
    transfer one reorders it, adds a constraint, and puts the membership gadget in
    front so nothing about position carries over.
    """
    s = _stream(seed, f"circuit:{case}")
    p = field_modulus(seed, case)
    if case == LIVE:
        return [
            {"id": "c0", "kind": "const", "signal": "role", "value": _pick(s, 0, 1, p - 1)},
            {"id": "c1", "kind": "boolean", "signal": "flag"},
            {"id": "c2", "kind": "mul", "left": "role", "right": "flag", "out": "gated"},
            {"id": "c3", "kind": "add", "left": "gated", "right": "bonus", "out": "score"},
            {"id": "c4", "kind": "const", "signal": "bonus", "value": _pick(s, 4, 0, p - 1)},
        ]
    return [
        {"id": "d0", "kind": "member", "signal": "tier", "allowed": allowed_set(seed, case)},
        {"id": "d1", "kind": "boolean", "signal": "active"},
        {"id": "d2", "kind": "mul", "left": "tier", "right": "active", "out": "weight"},
        {"id": "d3", "kind": "const", "signal": "quota", "value": _quota(seed)},
        {"id": "d4", "kind": "add", "left": "weight", "right": "quota", "out": "total"},
        {"id": "d5", "kind": "mul", "left": "total", "right": "active", "out": "billed"},
    ]


def _quota(seed: str) -> int:
    """The transfer case's constant, chosen so `total` is never zero.

    `d5` is `total * active - billed`. With `total = 0` it holds for any `active`,
    which would leave the `active` break with one fewer non-zero residual than the
    shape promises.
    """
    s = _stream(seed, "quota:transfer")
    p = field_modulus(seed, TRANSFER)
    tier = allowed_set(seed, TRANSFER)[_stream(seed, "tier:transfer")[0] % len(allowed_set(seed, TRANSFER))]
    quota = _pick(s, 0, 1, p - 1)
    while (tier + quota) % p == 0:
        quota = (quota + 1) % p
    return quota


def honest_witness(seed: str, case: str = LIVE) -> dict[str, int]:
    """The witness every residual is zero for. `audit show` prints it as the baseline."""
    p = field_modulus(seed, case)
    circ = circuit(seed, case)
    if case == LIVE:
        s = _stream(seed, "witness:live")
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
    allowed = allowed_set(seed, case)
    tier = allowed[_stream(seed, "tier:transfer")[0] % len(allowed)]
    quota = int(circ[3]["value"])  # type: ignore[arg-type]
    # `active = 1` rather than a coin flip: with `active = 0` the two multiplication
    # constraints hold whatever `tier` is, and the `tier` break would show up in one
    # residual instead of two.
    weight = tier % p
    total = (weight + quota) % p
    return {
        "tier": tier,
        "active": 1,
        "weight": weight,
        "quota": quota,
        "total": total,
        "billed": total,
    }


def break_signal(seed: str, case: str = LIVE) -> str:
    return BREAKS[case][_stream(seed, f"break:{case}")[0] % len(BREAKS[case])]


def failing_witness(seed: str, case: str = LIVE) -> dict[str, int]:
    """The witness the monitor refused. One signal is wrong; the trace says where."""
    s = _stream(seed, f"broken:{case}")
    p = field_modulus(seed, case)
    witness = dict(honest_witness(seed, case))
    signal = break_signal(seed, case)

    if signal == "flag":
        # Named `flag`, and only `c1` makes it a boolean. Here it is neither 0 nor 1.
        witness["flag"] = _pick(s, 0, 2, p - 1)
    elif signal == "active":
        witness["active"] = _pick(s, 0, 2, p - 1)
    elif signal == "tier":
        allowed = set(allowed_set(seed, case))
        candidate = _pick(s, 0, 0, p - 1)
        while candidate in allowed:
            candidate = (candidate + 1) % p
        witness["tier"] = candidate
    else:
        witness[signal] = (witness[signal] + _pick(s, 0, 1, p - 1)) % p
    return witness


def flag(seed: str) -> str:
    """Derived from the per-deploy seed, so it can be neither memorised nor guessed."""
    return f"TC{{constraint_lab_{hashlib.sha256(f'flag:{seed}'.encode()).hexdigest()[:20]}}}"
