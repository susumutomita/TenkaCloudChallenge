"""Private fixture generator: small arithmetic records, never a full FRI proof.

The first fold is nonconstant; the fixed alteration has exactly two nonzero
blind spots, and the displayed check point detects it. These teaching conditions
are public. This is not an independently random protocol execution.
"""
from __future__ import annotations

import ast
import hashlib

PRIMES = (5, 7)

# The eight answer fields, in participant order.
LINES = GRADED = (
    "poly", "fold", "fold2", "query", "recover", "consistency", "cheat-caught", "miss-points",
)

#: Expected-value shapes: every graded line is an int or a tuple of ints of fixed length.
TUPLE_LINES = {
    "poly": 3,
    "fold": 3,
    "query": 2,
    "recover": 4,
    "consistency": 2,
    "cheat-caught": 2,
    "miss-points": 6,
}


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Public numbers only. Expected values are computed by the separate verifier."""
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
    # square s² so this fixed example has one blind ±x pair. The last checkpoint
    # separately asks the participant to construct their own alterations.
    d1 = _draw(seed, "d1", 1, p - 1)
    s = _draw(seed, "s", 1, (p - 1) // 2)
    d0 = (-d1 * s * s) % p

    # The query point must catch the lie (x not on the miss pair) and be non-zero.
    x = _draw(seed, "x", 1, p - 1)
    while x in (s, p - s):
        x = x % (p - 1) + 1

    public = {
        "p": p, "q0": q0, "q1": q1, "q2": q2, "q3": q3,
        "beta": beta, "beta2": beta2, "x": x, "d0": d0, "d1": d1,
    }
    return {"public": public}


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


def submission_binding(seed: str) -> str:
    return hashlib.sha256(("ac26-w4-fri-drill:submission:v2\0"+seed).encode()).hexdigest()


def normalize_answer(line: str, raw: object):
    """Accept only actual integers, never bools/floats coerced into an answer."""
    if line not in GRADED:
        return None
    if isinstance(raw, str):
        try:
            raw = ast.literal_eval(raw.strip())
        except (ValueError, SyntaxError, TypeError, RecursionError):
            return None
    if line == "fold2":
        return raw if type(raw) is int else None
    width = TUPLE_LINES[line]
    if not isinstance(raw, (list, tuple)) or len(raw) != width:
        return None
    return tuple(raw) if all(type(value) is int for value in raw) else None
