"""This deployment's numbers, and the twelve values the SumCheck drill expects.

Everything the learner types is decided here from FLAG_SEED: a small prime field, the
four circuit inputs, the verifier's two random points, the honest prover's two messages
(as coefficients — what actually travels in the protocol), and the lying prover's two
fudge parameters. The learner never sees the expected values — they see the assignment
statements (``show.py``) and produce every value with their own Python, one line at a
time.

The circuit is the two-gate toy from the Week 4 lecture's GKR section — y₀ = x₁ + x₂,
y₁ = x₃·x₄, output y₀ + y₁ — but the inputs, the field, and the verifier's randomness
are this deployment's own (the independent-reimplementation rule): the procedure is the
lecture's, the numbers are not.

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
scripts/ac26-w4-sumcheck-drill.test.ts for the regression
test pinning the values this move must not change.
"""

from __future__ import annotations

import hashlib

PRIMES = (11, 13, 17, 19, 23)

# The line ids, in drill order. server.py, show.py, the tests and metadata.json all read
# these tuples, so the drill's order and its graded subset are defined in one place.
LINES = (
    "circuit",
    "mle",
    "grid",
    "grid-total",
    "p1-sum",
    "p1-check",
    "round1",
    "p2-sum",
    "final-check",
    "lie",
    "lie-caught",
    "miss-points",
)

# The lines that have an answer field. The platform allows at most eight checkpoints per
# problem, so four lines (the four-term sum, the two sum checks, the all-points check)
# are ungraded material: each equals a value the learner already produced, or feeds the
# line after it, where a mistake surfaces.
GRADED = (
    "circuit",
    "mle",
    "grid",
    "round1",
    "final-check",
    "lie",
    "lie-caught",
    "miss-points",
)

#: Expected-value shapes: every graded line is an int or a tuple of ints of fixed length.
TUPLE_LINES = {
    "circuit": 3,
    "mle": 3,
    "grid": 4,
    "final-check": 2,
    "lie": 2,
    "lie-caught": 3,
    "miss-points": 2,
}


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Everything public — what show.py prints. See the module docstring: the expected
    value of each graded line is computed only by verifier/expected.py, from this
    return value, and is not part of it."""
    p = PRIMES[_draw(seed, "field", 0, len(PRIMES) - 1)]

    x1 = _draw(seed, "x1", 1, p - 1)
    x2 = _draw(seed, "x2", 1, p - 1)
    x3 = _draw(seed, "x3", 1, p - 1)
    x4 = _draw(seed, "x4", 1, p - 1)
    # The drill needs a non-degenerate instance: both layer values non-zero (the wiring
    # polynomial visibly carries something), distinct (the MLE is a real line, and the
    # swapped-MLE mistake is distinguishable), and a non-zero output (the claim is not
    # the sentinel 0). Bumping x2 / x4 preserves seed-determinism.
    while (x1 + x2) % p == 0 or (x1 + x2) % p == (x3 * x4) % p:
        x2 = x2 % (p - 1) + 1
    while (x3 * x4) % p == 0 or (x1 + x2) % p == (x3 * x4) % p or ((x1 + x2) + x3 * x4) % p == 0:
        x4 = x4 % (p - 1) + 1
    y0 = (x1 + x2) % p
    y1 = (x3 * x4) % p
    out = (y0 + y1) % p

    def w1(z: int) -> int:
        return (y0 * (1 - z) + y1 * z) % p

    # The honest prover's messages, as the coefficients that travel in the protocol.
    # p1(t) = sum_b g0(t, b) = (1 - t)(W1(t) + y1) expands to:
    c0, c1, c2 = out, (-2 * y0) % p, (y0 - y1) % p
    # p2(t) = g0(r1, t) = (1 - r1)·t·(W1(r1) + W1(t)) expands to b1·t + b2·t²:
    r1 = _draw(seed, "r1", 2, p - 1)
    # p1(r1) must not equal the shown coefficient c0 (that happens exactly at the one
    # r1 with c1 + c2·r1 ≡ 0), so the pasted value is never a number already on screen.
    while (c1 + c2 * r1) % p == 0:
        r1 = r1 % (p - 2) + 2
    b1 = ((1 - r1) * (w1(r1) + y0)) % p
    b2 = ((1 - r1) * (y1 - y0)) % p

    # The lying prover: inflate the claim by d, cover round 2 with sh·(1−t) + m·t·(1−t).
    d = _draw(seed, "d", 1, p - 1)
    sh = (d * (1 - r1)) % p
    m = _draw(seed, "m", 1, p - 1)
    if m == (-sh) % p:  # a double root at t = 1 would leave only one miss point
        m = m % (p - 1) + 1
        if m == (-sh) % p:
            m = m % (p - 1) + 1
    t_star = ((-sh) * pow(m, p - 2, p)) % p

    # The verifier's second point must actually catch the lie (not land on a miss point).
    r2 = _draw(seed, "r2", 2, p - 1)
    while r2 in (1, t_star):
        r2 = r2 % (p - 2) + 2

    public = {
        "p": p, "x1": x1, "x2": x2, "x3": x3, "x4": x4,
        "r1": r1, "r2": r2,
        "c0": c0, "c1": c1, "c2": c2, "b1": b1, "b2": b2,
        "d": d, "m": m,
    }
    return {"public": public}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"p = {pub['p']}",
            f"x1, x2, x3, x4 = {pub['x1']}, {pub['x2']}, {pub['x3']}, {pub['x4']}",
            f"r1, r2 = {pub['r1']}, {pub['r2']}",
            f"c0, c1, c2 = {pub['c0']}, {pub['c1']}, {pub['c2']}",
            f"b1, b2 = {pub['b1']}, {pub['b2']}",
            f"d, m = {pub['d']}, {pub['m']}",
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
