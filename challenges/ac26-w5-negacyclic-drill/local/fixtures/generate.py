"""This deployment's numbers, and the twelve values the negacyclic drill expects.

Everything the learner types is decided here from FLAG_SEED: the ring size n, the plaintext
modulus p (hence the scaling factor), how much noise the two input ciphertexts carry, and
the two probe indices used to show the sign flip. The learner never sees the expected
values -- they see the assignment statements (``show.py``) and produce every value with
their own Python, one line at a time.

The procedure is the Week 5 lecture's: `x^n = -1 mod x^n+1` (slide 21), the hazard that
slide 35 leaves as an open question ("what goes wrong if Blind Rotation lands past n?"),
and the HomNAND construction of slides 43-45 that turns that same sign flip into the
mechanism. The numbers are this deployment's own (the independent-reimplementation rule):
the lecture's own worked example (p=8, n=16) is excluded below so that no deployment can
be solved by copying the slide.

One correction the drill relies on. Slide 44 states the condition for HomNAND as
"3 < n < p-1", which does not hold for the lecture's own example (3 < 16 < 7 is false).
The condition that actually governs it, verified by brute force over every (n, p, dmax)
this generator can draw, is

    3 * DELTA < n      (equivalently p > 6, since DELTA = 2n/p)
    dmax <= DELTA

`_admissible` below enumerates exactly the pairs satisfying it, so every seed produces a
deployment where the truth table closes for every noise value in range.

Nothing here is cryptographic. Toy parameters are for observability.
"""

from __future__ import annotations

import hashlib

#: Ring sizes and plaintext moduli the drill may draw from.
DEGREES = (16, 32, 64)
PLAINTEXT_MODULI = (8, 16, 32)

#: The lecture's own worked example (slide 45). Excluded so a deployment is never the
#: slide: the procedure is the lecture's, the numbers are not.
LECTURE_EXAMPLE = (16, 8)

# The line ids, in drill order. server.py, show.py, the tests and metadata.json all read
# these tuples, so the drill's order and its graded subset are defined in one place.
LINES = (
    "params",
    "wrap",
    "signs",
    "boundary",
    "hazard",
    "encoding",
    "phases",
    "rotations",
    "constants",
    "nand",
    "noise-sweep",
    "margin",
)

# The lines that have an answer field. The platform allows at most eight checkpoints per
# problem, so four lines (the bit encoding, the NAND column, and the two lines whose value
# is a constant of the construction) are ungraded material: the statement explains them in
# place and the lines that follow them are where the work shows.
GRADED = (
    "params",
    "wrap",
    "signs",
    "boundary",
    "hazard",
    "rotations",
    "constants",
    "margin",
)

#: Expected-value shapes: every graded line is an int, a bool, or a tuple of ints.
TUPLE_LINES = {
    "params": 4,
    "wrap": 3,
    "signs": 6,
    "hazard": 2,
    "rotations": 4,
    "constants": 4,
}

BOOL_LINES = ("noise-sweep",)


def _draw(seed: str, label: str, low: int, high: int) -> int:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return low + int.from_bytes(digest[:8], "big") % (high - low + 1)


def _admissible() -> tuple[tuple[int, int, int], ...]:
    """Every (n, p, dmax) for which the HomNAND truth table closes on all noise values.

    Derived, not asserted: 3*DELTA < n keeps the r = 3 rotation below the sign boundary,
    and dmax <= DELTA keeps the r = 1 rotation from going negative and wrapping past it.
    The lecture's own (n, p) is dropped.
    """
    out = []
    for degree in DEGREES:
        for modulus in PLAINTEXT_MODULI:
            if (2 * degree) % modulus:
                continue
            delta = 2 * degree // modulus
            if 3 * delta >= degree:
                continue
            if (degree, modulus) == LECTURE_EXAMPLE:
                continue
            for dmax in (1, 2, 3):
                if dmax <= delta:
                    out.append((degree, modulus, dmax))
    return tuple(out)


def _reduce_monomial(exponent: int, degree: int) -> tuple[int, int, int]:
    """`x^exponent mod x^n + 1` as (reduced exponent, sign, the exponent before reducing).

    Each time n is subtracted the sign flips, because `x^n = -1`. The third element is
    kept so the line's answer says which exponent was reduced, not only the result.
    """
    sign, reduced = 1, exponent
    while reduced >= degree:
        reduced -= degree
        sign = -sign
    return (reduced, sign, exponent)


def constant_term(coefficients, index: int) -> int:
    """The constant term of `x^(-index) * v(x)  mod x^n + 1`.

    Below n the coefficient comes out as it is; at or above n it comes out negated, which
    is the whole subject of this drill.
    """
    degree = len(coefficients)
    wrapped = index % (2 * degree)
    if wrapped < degree:
        return coefficients[wrapped]
    return -coefficients[wrapped - degree]


def setting(seed: str) -> dict:
    """Everything public (shown by show.py) and everything expected (kept by server.py)."""
    options = _admissible()
    degree, modulus, dmax = options[_draw(seed, "params", 0, len(options) - 1)]
    q = 2 * degree
    delta = q // modulus

    # The two input ciphertexts' noise. Their sum is what shifts the rotation.
    noise_a = _draw(seed, "noise-a", 0, dmax)
    noise_b = _draw(seed, "noise-b", 0, dmax - noise_a) if dmax - noise_a >= 0 else 0
    total_noise = noise_a + noise_b

    # Two probe indices for the hazard line: one below the boundary, one at or above it.
    # Kept away from 0 and from the boundary itself so neither is guessable from the shape.
    low_probe = _draw(seed, "low-probe", 1, degree - 2)
    high_probe = _draw(seed, "high-probe", degree + 1, 2 * degree - 2)

    # Six probe indices for the sign line, drawn across the whole 2n range. Drawn rather
    # than placed: three fixed on each side of the boundary would make the answer the same
    # (1, 1, 1, -1, -1, -1) under every seed, and a learner could copy it from any other
    # deployment without ever reducing anything. At least one index must land on each side,
    # so the line still shows both signs.
    probes = tuple(_draw(seed, f"probe-{k}", 0, 2 * degree - 1) for k in range(6))
    if all(i < degree for i in probes):
        probes = probes[:5] + (_draw(seed, "probe-fix-high", degree, 2 * degree - 1),)
    elif all(i >= degree for i in probes):
        probes = probes[:5] + (_draw(seed, "probe-fix-low", 0, degree - 1),)

    v = [1] * degree
    encoding = {0: modulus - 1, 1: 1}

    def phase(bit_a: int, bit_b: int) -> int:
        return (1 - encoding[bit_a] - encoding[bit_b]) % modulus

    pairs = ((0, 0), (0, 1), (1, 0), (1, 1))
    phases = tuple(phase(*pair) for pair in pairs)
    rotations = tuple((delta * ph - total_noise) % q for ph in phases)
    constants = tuple(constant_term(v, rot) for rot in rotations)
    nand = tuple(1 - (a & b) for a, b in pairs)

    # The sweep: every noise total the parameters allow, not just this deployment's.
    sweep = all(
        constant_term(v, delta * phase(a, b) - d) == (1 if 1 - (a & b) else -1)
        for a, b in pairs
        for d in range(dmax + 1)
    )

    # The margin line: how much room is left before the r = 3 rotation would cross the
    # boundary. This is the quantity slide 44's stated condition was reaching for.
    margin = degree - 3 * delta

    expected = {
        "params": (modulus, q, degree, delta),
        "wrap": _reduce_monomial(low_probe + high_probe, degree),
        "signs": tuple(constant_term(v, i) for i in probes),
        "boundary": degree,
        "hazard": (low_probe + degree, constant_term(v, low_probe + degree)),
        "encoding": (modulus - 1, 1),
        "phases": phases,
        "rotations": rotations,
        "constants": constants,
        "nand": nand,
        "noise-sweep": sweep,
        "margin": margin,
    }
    public = {
        "p": modulus,
        "q": q,
        "n": degree,
        "dmax": dmax,
        "noise_a": noise_a,
        "noise_b": noise_b,
        "low_probe": low_probe,
        "high_probe": high_probe,
        "probes": list(probes),
    }
    return {"public": public, "expected": expected}


def assignments(seed: str) -> str:
    """The public values as Python assignment statements, ready to paste into a REPL."""
    pub = setting(seed)["public"]
    return "\n".join(
        [
            f"p, n = {pub['p']}, {pub['n']}",
            f"q = 2 * n",
            f"D = q // p",
            f"v = [1] * n",
            f"noise_a, noise_b = {pub['noise_a']}, {pub['noise_b']}",
            f"dmax = {pub['dmax']}",
            f"lo, hi = {pub['low_probe']}, {pub['high_probe']}",
            f"probes = {pub['probes']}",
        ]
    )


def normalize_answer(line: str, raw: object):
    """Turn whatever the learner pasted into the shape the expected value has.

    Integers may arrive as int or as a digit string. Tuples may arrive as a JSON list,
    a tuple-looking string "(a, b, c)", or "a, b, c" -- the length must match the line's
    shape exactly. Booleans arrive as a bool or as "True"/"False". Anything else is wrong.
    """
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
