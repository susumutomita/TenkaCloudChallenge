"""This deployment's numbers, and the ten values the unknown-x drill expects.

Everything the learner types is decided here from FLAG_SEED: two small numbers a and b,
a small cover x, a huge cover X, and the modulus n. The learner never sees the expected
values -- they see the assignment statements (``show.py``) and produce every value with
their own Python, one line at a time.

The subject is one line of school algebra:

    (a + x) + (b + x) = (a + b) + 2x

The left side becomes the right side without anyone knowing what x is. That is the whole
foundation of this course: hiding a number under a cover, and computing anyway. The drill
walks it three times -- with a small x you can see, with a huge x you cannot, and from the
point of view of someone who only holds the covered values and never learns the cover.

The last two lines turn to multiplication and find the wall: (a + x)(b + x) carries an x²
term, so the same trick does not survive a product. That wall is why Beaver triples exist
in secret computation and why bootstrapping exists in homomorphic encryption. A learner
who meets it here, in one line of expansion, has met it before it has a name.

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
    "product",
    "wall",
)

# The lines that have an answer field. The platform allows at most eight checkpoints, so
# two lines are ungraded: "same" is the True that closes the first claim, and "wall" is
# the closing observation whose content is already carried by "product".
GRADED = (
    "covered",
    "sum-covered",
    "sum-plain",
    "huge",
    "held",
    "recover",
    "guesses",
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

    # The huge cover: the same algebra, at a size no one can eyeball. This is the step
    # where "I could just work out x" stops being available.
    huge = _draw(seed, "huge", 10**14, 10**15)

    # The modulus for the "what can the holder rule out" line. Small enough to enumerate.
    n = _draw(seed, "n", 17, 41)
    while n <= a + b + 2 * x:      # every candidate must fit, so the count is honest
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

    # How many (a, b) pairs in Z_n are consistent with the single covered value a + x,
    # if x is unknown and could be anything in Z_n. The answer is n: every value of a has
    # exactly one x that produces this covered number. Nothing is ruled out.
    first_covered = covered[0] % n
    guesses = sum(1 for cand_a in range(n)
                  if any((cand_a + cand_x) % n == first_covered for cand_x in range(n)))

    # The wall. Expanding (a + x)(b + x) gives ab + (a + b)x + x², and that x² is a term
    # nobody holding only covered values can produce or cancel.
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
