"""This deployment's numbers, and the twelve values the FRI drill expects.

Everything the learner types is decided here from FLAG_SEED: a small odd prime field,
the four coefficients of the committed polynomial Q₀ (degree exactly 3), the verifier's
two folding challenges β and β₂, the query point x, and the dishonest fold's difference
d0 + d1·Y. The learner never sees the expected values — they see the assignment
statements (``show.py``) and produce every value with their own Python, one line at a
time.

The procedure — even/odd split, fold with β, the x/−x query, recovering both halves,
the consistency check — is the Week 4 lecture's FRI section; the numbers are this
deployment's own (the independent-reimplementation rule).

Nothing here is cryptographic. Toy parameters are for observability.
"""

from __future__ import annotations

import hashlib

PRIMES = (17, 19, 23, 29, 31)

# The line ids, in drill order. server.py, show.py, the tests and metadata.json all read
# these tuples, so the drill's order and its graded subset are defined in one place.
LINES = (
    "poly",
    "split",
    "identity",
    "fold",
    "fold2",
    "query",
    "recover",
    "consistency",
    "cheat",
    "cheat-caught",
    "miss-points",
    "honest-all",
)

# The lines that have an answer field. The platform allows at most eight checkpoints per
# problem, so four lines (the split, the all-points identity, the cheat's setup, and the
# closing completeness sweep) are ungraded material whose correctness surfaces in the
# lines that follow them.
GRADED = (
    "poly",
    "fold",
    "fold2",
    "query",
    "recover",
    "consistency",
    "cheat-caught",
    "miss-points",
)

#: Expected-value shapes: every graded line is an int or a tuple of ints of fixed length.
TUPLE_LINES = {
    "poly": 3,
    "fold": 3,
    "query": 2,
    "recover": 4,
    "consistency": 2,
    "cheat-caught": 2,
    "miss-points": 2,
}


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Everything public (shown by show.py) and everything expected (kept by server.py)."""
    p = PRIMES[_draw(seed, "field", 0, len(PRIMES) - 1)]

    q0 = _draw(seed, "q0", 0, p - 1)
    q1 = _draw(seed, "q1", 1, p - 1)
    q2 = _draw(seed, "q2", 1, p - 1)
    q3 = _draw(seed, "q3", 1, p - 1)  # degree exactly 3, and a genuine odd part

    beta = _draw(seed, "beta", 1, p - 1)
    # Q1 = (q0 + β·q1) + (q2 + β·q3)·Y must have degree exactly 1, so the second fold's
    # linear coefficient d is non-zero and "fold once more" genuinely folds something.
    while (q2 + beta * q3) % p == 0:
        beta = beta % (p - 1) + 1
    beta2 = _draw(seed, "beta2", 1, p - 1)

    # The dishonest fold's difference d0 + d1·Y: d1 non-zero, and its vanishing Y is a
    # square s² so the miss set is exactly one ±x pair — the story of the last graded
    # line holds on every seed.
    d1 = _draw(seed, "d1", 1, p - 1)
    s = _draw(seed, "s", 1, (p - 1) // 2)
    d0 = (-d1 * s * s) % p

    # The query point must catch the lie (x not on the miss pair) and be non-zero.
    x = _draw(seed, "x", 1, p - 1)
    while x in (s, p - s):
        x = x % (p - 1) + 1

    def Q(X: int) -> int:
        return (q0 + q1 * X + q2 * X * X + q3 * X * X * X) % p

    def Qe(Y: int) -> int:
        return (q0 + q2 * Y) % p

    def Qo(Y: int) -> int:
        return (q1 + q3 * Y) % p

    def Q1(Y: int) -> int:
        return (Qe(Y) + beta * Qo(Y)) % p

    def Q1c(Y: int) -> int:
        return (Q1(Y) + d0 + d1 * Y) % p

    inv2 = pow(2, p - 2, p)
    xx = x * x % p
    re = (Q(x) + Q((-x) % p)) * inv2 % p
    ro = (Q(x) - Q((-x) % p)) * pow(2 * x, p - 2, p) % p
    c, d = Q1(0), (Q1(1) - Q1(0)) % p

    expected = {
        "poly": (Q(0), Q(1), Q(2)),
        "split": (Qe(1), Qo(1)),
        "identity": True,
        "fold": (Q1(0), Q1(1), Q1(2)),
        "fold2": (c + beta2 * d) % p,
        "query": (Q(x), Q((-x) % p)),
        "recover": (re, ro, Qe(xx), Qo(xx)),
        "consistency": ((re + beta * ro) % p, Q1(xx)),
        "cheat": (Q1c(0), Q1c(1)),
        "cheat-caught": ((re + beta * ro) % p, Q1c(xx)),
        "miss-points": (min(s, p - s), max(s, p - s)),
        "honest-all": (),
    }
    public = {
        "p": p, "q0": q0, "q1": q1, "q2": q2, "q3": q3,
        "beta": beta, "beta2": beta2, "x": x, "d0": d0, "d1": d1,
    }
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"p = {pub['p']}",
            f"q0, q1, q2, q3 = {pub['q0']}, {pub['q1']}, {pub['q2']}, {pub['q3']}",
            f"beta, beta2 = {pub['beta']}, {pub['beta2']}",
            f"x = {pub['x']}",
            f"d0, d1 = {pub['d0']}, {pub['d1']}",
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
