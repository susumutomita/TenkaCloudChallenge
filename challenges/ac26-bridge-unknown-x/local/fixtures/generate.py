"""This deployment's numbers, and the eleven values the unknown-x drill expects.

Everything the learner types is decided here from FLAG_SEED: two small numbers a and b,
a small cover x, a huge cover X, and the modulus n. The learner never sees the expected
values -- they see the assignment statements (``show.py``) and produce every value with
their own Python, one line at a time.

The subject is one line of school algebra:

    (a + x) + (b + x) = (a + b) + 2x

The equality checks arithmetic correctness, not secrecy. The separate candidate
experiment uses the complete remainder range. Reusing a cover reveals at least the
difference; multiplying requires both cross terms and the square of the cover.

Nothing here is cryptographic. The numbers are small so they can be checked by hand.
"""

from __future__ import annotations

import hashlib

# The line ids, in drill order. server.py, show.py, the tests and metadata.json all read
# these tuples, so the drill's order and its graded subset are defined in one place.
LINES = (
    "covered",
    "sum-covered",
    "sum-plain",
    "same",
    "huge",
    "held",
    "recover",
    "guesses",
    "gap",
    "product",
    "wall",
)

# The lines that have an answer field. The platform allows at most eight checkpoints, so
# three lines are ungraded: "same" and "wall" are the True/False that close two claims,
# and "sum-plain" is the same number as "sum-covered" once the first claim lands.
GRADED = (
    "covered",
    "sum-covered",
    "huge",
    "held",
    "recover",
    "guesses",
    "gap",
    "product",
)

#: Expected-value shapes: every graded line is an int or a tuple of ints of fixed length.
TUPLE_LINES = {
    "covered": 2,
    "held": 2,
    "product": 3,
}

BOOL_LINES = ("same",)


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def setting(seed: str) -> dict:
    """Everything public (shown by show.py) and everything expected (kept by server.py)."""
    # a and b: small enough to add in your head, distinct so the two covered values differ.
    a = _draw(seed, "a", 2, 9)
    b = _draw(seed, "b", 2, 9)
    while b == a:
        b = b % 9 + 2

    # The small cover. Kept away from a and b so no covered value coincides with a plain
    # one, and away from 1 so that 2x is not mistaken for x + 1.
    x = _draw(seed, "x", 3, 15)
    while x in (a, b, 1):
        x = x % 15 + 3

    # The huge cover: the same algebra with larger operands; this tests correctness,
    # not the difficulty of guessing a value.
    huge = _draw(seed, "huge", 10**14, 10**15)

    # The modulus for the "what can the holder rule out" line. Small enough to enumerate.
    n = _draw(seed, "n", 17, 41)
    while n <= a + b + 2 * x:      # keep the earlier integer observations within the remainder range
        n += 8

    covered = (a + x, b + x)
    sum_covered = covered[0] + covered[1]
    sum_plain = (a + b) + 2 * x

    # The huge case, done as a difference so the learner sees 0 rather than a 16-digit
    # number they cannot check.
    huge_gap = ((a + huge) + (b + huge)) - ((a + b) + 2 * huge)

    # The holder's view: someone who receives the two covered numbers and never learns x.
    # They can add them. They cannot separate a from x.
    held_sum = sum_covered
    recovered = held_sum - 2 * x          # subtracting the cover twice returns a + b

    # How many values of a are consistent with ONE covered value a + x, when x is unknown
    # and could be anything in Z_n. The answer is n: every candidate has exactly one cover
    # producing this number, so this distinct full-range model rules no candidate out.
    #
    # "ONE" is load-bearing. Both covered values here share the same cover, so anyone
    # holding both can subtract them and the cover cancels: (a + x) - (b + x) = a - b.
    # The difference leaks; this does not claim the original narrow ranges hide every
    # property of each value. That is not a
    # flaw to hide -- it is the next problem's entire subject, and the learner meets it
    # here, after the separate candidate experiment. `gap` below is that leak.
    first_covered = covered[0] % n
    guesses = sum(1 for cand_a in range(n)
                  if any((cand_a + cand_x) % n == first_covered for cand_x in range(n)))
    gap = covered[0] - covered[1]          # == a - b, with x gone

    # The wall. Expanding (a + x)(b + x) gives ab + (a + b)x + x², and that x² is a term
    # the expansion contains in addition to (a+b)*x. Both terms must be removed
    # to recover ab; this is not an impossibility result for multiplication.
    prod_covered = covered[0] * covered[1]
    prod_expected_without_square = a * b + (a + b) * x
    leftover = prod_covered - prod_expected_without_square      # == x * x

    expected = {
        "covered": covered,
        "sum-covered": sum_covered,
        "sum-plain": sum_plain,
        "same": sum_covered == sum_plain,
        "huge": huge_gap,
        "held": (held_sum, 2 * x),
        "recover": recovered,
        "guesses": guesses,
        "gap": gap,
        "product": (prod_covered, prod_expected_without_square, leftover),
        "wall": leftover == x * x,
    }
    public = {"a": a, "b": b, "x": x, "huge": huge, "n": n}
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"a, b = {pub['a']}, {pub['b']}",
            f"x = {pub['x']}",
            f"huge = {pub['huge']}",
            f"n = {pub['n']}",
        ]
    )


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape the expected value has."""
    if line in BOOL_LINES:
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and raw.strip().lower() in ("true", "false"):
            return raw.strip().lower() == "true"
        return None
    width = TUPLE_LINES.get(line)
    if width is not None:
        if isinstance(raw, str):
            cleaned = raw.strip().strip("()[]")
            parts = [part.strip() for part in cleaned.split(",") if part.strip() != ""]
        elif isinstance(raw, (list, tuple)):
            parts = list(raw)
        else:
            return None
        # Integer answers are exact: int(float) would silently accept a truncated value.
        if len(parts) != width or any(type(part) not in (int, str) for part in parts):
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
