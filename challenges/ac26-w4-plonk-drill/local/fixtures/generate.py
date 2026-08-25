"""This deployment's numbers, and the twelve values the PLONK drill expects.

Everything the learner types is decided here from FLAG_SEED: a small prime field for the
gate arithmetic, the four circuit inputs, the lie's shift g, and — for the grand product —
a second prime q, the address base ω, and the verifier's randomness β, γ. The learner
never sees the expected values — they see the assignment statements (``show.py``) and
produce every value with their own Python, one line at a time.

The circuit is the three-gate table from the Week 4 lecture's PLONK section (two gates
feeding an adder, wired by σ), but the inputs, the fields, and the randomness are this
deployment's own (the independent-reimplementation rule): the procedure is the lecture's,
the numbers are not.

Nothing here is cryptographic. Toy parameters are for observability.

This module hands back the PUBLIC state only (what ``show.py`` prints). It no longer
computes or exports the twelve lines' expected values as their own callable result:
before #537, that dict shipped here and could be read back with one import, which was
the entire drill for free. ``verifier/expected.py`` recomputes each checkpoint's value
from this public state at grading time instead -- but read that module's own docstring
before assuming this closes the leak: it does not. This module and the participant-
facing tests no longer point at the answer by accident; a participant who deliberately
imports ``verifier.expected`` instead still gets it, because this single-stage drill
template has no isolated verifier container to keep it out of. See #537 and
scripts/ac26-w4-plonk-drill.test.ts for the regression
test pinning the values this move must not change.
"""

from __future__ import annotations

import hashlib

GATE_PRIMES = (11, 13, 17, 19, 23)
PRODUCT_PRIMES = (101, 103, 107, 109, 113)

# The line ids, in drill order. server.py, show.py, the tests and metadata.json all read
# these tuples, so the drill's order and its graded subset are defined in one place.
LINES = (
    "outputs",
    "gate-eq",
    "copy",
    "bad-row",
    "bad-passes",
    "addresses",
    "sigma-addresses",
    "marks",
    "grand-product",
    "bad-product",
    "multiset",
    "miss-count",
)

# The lines that have an answer field. The platform allows at most eight checkpoints per
# problem, so four lines (the two honest checks, the lying table's side-by-side, and the
# set comparison) are ungraded material: their values are constants of the construction
# ([0,0,0], (True, True), …) whose meaning the statement explains in place.
GRADED = (
    "outputs",
    "bad-row",
    "addresses",
    "sigma-addresses",
    "marks",
    "grand-product",
    "bad-product",
    "miss-count",
)

#: Expected-value shapes: every graded line is an int or a tuple of ints of fixed length.
TUPLE_LINES = {
    "outputs": 3,
    "bad-row": 3,
    "addresses": 9,
    "sigma-addresses": 9,
    "marks": 3,
    "grand-product": 2,
    "bad-product": 2,
}

#: σ as (column, row) → (column, row): the two wires of the circuit, everything else fixed.
SIGMA = {
    (0, 0): (0, 0), (1, 0): (1, 0), (2, 0): (0, 2),
    (0, 1): (0, 1), (1, 1): (1, 1), (2, 1): (1, 2),
    (0, 2): (2, 0), (1, 2): (2, 1), (2, 2): (2, 2),
}
SELECTORS = ((1, 1, 0, -1, 0), (0, 0, 1, -1, 0), (1, 1, 0, -1, 0))


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Everything public — what show.py prints. See the module docstring: the expected
    value of each graded line is computed only by verifier/expected.py, from this
    return value, and is not part of it."""
    p = GATE_PRIMES[_draw(seed, "gate-field", 0, len(GATE_PRIMES) - 1)]
    q = PRODUCT_PRIMES[_draw(seed, "product-field", 0, len(PRODUCT_PRIMES) - 1)]

    a0 = _draw(seed, "a0", 1, p - 1)
    b0 = _draw(seed, "b0", 1, p - 1)
    a1 = _draw(seed, "a1", 1, p - 1)
    b1 = _draw(seed, "b1", 1, p - 1)
    # Non-degenerate gates: every output non-zero, so no row of the table is trivial.
    while (a0 + b0) % p == 0:
        b0 = b0 % (p - 1) + 1
    while (a1 * b1) % p == 0 or ((a0 + b0) + a1 * b1) % p == 0:
        b1 = b1 % (p - 1) + 1
    o0 = (a0 + b0) % p
    o1 = (a1 * b1) % p
    o2 = (o0 + o1) % p
    g = _draw(seed, "g", 1, p - 1)

    rows = ((a0, b0, o0), (a1, b1, o1), (o0, o1, o2))
    bad2 = ((o0 + g) % p, o1, (o0 + g + o1) % p)
    bad = (rows[0], rows[1], bad2)

    # Addresses: ω^row · (col + 1) mod q, all nine distinct (bump ω until they are).
    w = _draw(seed, "w", 2, q - 2)

    def address_list(base: int) -> list[int]:
        return [(pow(base, r, q) * (c + 1)) % q for r in range(3) for c in range(3)]

    while len(set(address_list(w))) != 9:
        w = w % (q - 3) + 2
    addr = address_list(w)
    saddr = [
        (pow(w, SIGMA[(c, r)][1], q) * (SIGMA[(c, r)][0] + 1)) % q
        for r in range(3)
        for c in range(3)
    ]

    vals = [v for row in rows for v in row]
    vb = [v for row in bad for v in row]

    # β, γ: every fingerprint of both tables non-zero, so the shown pair tells the honest
    # and the lying table apart (a zero mark collapses both products to 0 — that escape is
    # what the last line counts, not what the worked example should sit on).
    beta = _draw(seed, "beta", 1, q - 1)
    gamma = _draw(seed, "gamma", 0, q - 1)

    def all_marks_nonzero(b: int, c: int) -> bool:
        for value, a in list(zip(vals, addr)) + list(zip(vb, addr)) + list(zip(vb, saddr)):
            if (value + b * a + c) % q == 0:
                return False
        return True

    while not all_marks_nonzero(beta, gamma):
        gamma = (gamma + 1) % q

    public = {
        "p": p, "a0": a0, "b0": b0, "a1": a1, "b1": b1, "g": g,
        "q": q, "w": w, "beta": beta, "gamma": gamma,
    }
    return {"public": public}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"p = {pub['p']}",
            f"a0, b0, a1, b1 = {pub['a0']}, {pub['b0']}, {pub['a1']}, {pub['b1']}",
            f"g = {pub['g']}",
            f"q, w = {pub['q']}, {pub['w']}",
            f"beta, gamma = {pub['beta']}, {pub['gamma']}",
        ]
    )


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape the expected value has.

    Integers may arrive as int or as a digit string. Tuples may arrive as a JSON list,
    a tuple-looking string "(a, b, c)", or "a, b, c" — the length must match the line's
    shape exactly. Anything else is simply wrong.
    """
    width = TUPLE_LINES.get(line)
    if width is not None:
        if isinstance(raw, str):
            cleaned = raw.strip().strip("()[]")
            parts = [part.strip() for part in cleaned.split(",") if part.strip() != ""]
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        if len(parts) != width:
            return None
        try:
            return tuple(int(part) for part in parts)
        except (TypeError, ValueError):
            return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw.strip())
        except ValueError:
            return None
    return None
