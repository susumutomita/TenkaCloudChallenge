"""Reference implementation. Lives inside the image only; not bind-mounted.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

The ring and the RLWE scheme are supplied by `fixtures.generate` -- this problem is about
the gadget and the external product, not about re-deriving Week 5's second problem. Nothing
here hardcodes a base, a level count, or a degree, because `transfer` runs the whole file
under parameters derived from a different seed.
"""

from __future__ import annotations

from fixtures.generate import ring_add, ring_mul


# ---------------------------------------------------------------------------
# The gadget
# ---------------------------------------------------------------------------


def gadget_vector(params: dict) -> tuple[int, ...]:
    """`(1, B, B^2, ..., B^(L-1))` -- least significant first, matching `decompose`.

    The order is a convention, and the only thing that makes it a convention rather than an
    arbitrary choice is that `decompose` and this agree. Reverse one and not the other and
    every recomposition is wrong; reverse both and the round trip still passes, which is why
    the hidden tests check this vector directly rather than only through a round trip.
    """
    return tuple(params["base"] ** index for index in range(params["levels"]))


def decompose(params: dict, value: int) -> tuple[int, ...]:
    """Unsigned base-B digits of `value mod q`, least significant first, exactly L of them.

    `value % q` first: the digits describe a ring element, and a caller handing over a raw
    integer should get the same answer as one handing over its representative. Under these
    parameters that reduction is not load-bearing -- taking exactly `levels` base-B digits
    already **is** reduction modulo `base ** levels` -- so it is not in the mutation suite.
    It stays because it says what is meant, and because it would be load-bearing under an
    approximate gadget.
    """
    base, remaining = params["base"], value % params["modulus"]
    digits = []
    for _ in range(params["levels"]):
        digits.append(remaining % base)
        remaining //= base
    return tuple(digits)


def recompose(params: dict, digits) -> int:
    """The inner product of the digits with the gadget, back in the ring.

    Exact for every value in `[0, q)` **because** `q = base ** levels`. That is a property
    of these parameters, not of gadget decomposition in general -- see `levels_needed`.

    The `% modulus` is the same story as the one in `decompose`: `levels` digits each below
    `base`, weighted by the gadget, sum to at most `q - 1`, so it never fires here. Not
    mutated, kept for the same two reasons.
    """
    return sum(d * g for d, g in zip(digits, gadget_vector(params))) % params["modulus"]


def decompose_poly(params: dict, poly) -> tuple[tuple[int, ...], ...]:
    """`levels` polynomials; level i holds digit i of every coefficient.

    Note the shape: this is **not** a list of per-coefficient digit tuples. Level i has to
    be a ring element in its own right, because the external product multiplies it by a
    ring element. Transposing the two is the mutation that a square-shaped test misses.
    """
    degree = params["degree"]
    padded = list(poly)[:degree] + [0] * (degree - len(list(poly)[:degree]))
    per_coefficient = [decompose(params, c) for c in padded]
    return tuple(
        tuple(per_coefficient[k][i] for k in range(degree))
        for i in range(params["levels"])
    )


def recompose_poly(params: dict, levels) -> tuple[int, ...]:
    gadget = gadget_vector(params)
    degree = params["degree"]
    return tuple(
        sum(levels[i][k] * gadget[i] for i in range(params["levels"])) % params["modulus"]
        for k in range(degree)
    )


# ---------------------------------------------------------------------------
# When the levels run out
# ---------------------------------------------------------------------------


def levels_needed(base: int, modulus: int) -> int:
    """How many base-B digits it takes to reach every value below `modulus`.

    Counted rather than computed with a logarithm: floating point gets `log(1000, 10)`
    wrong often enough that an off-by-one here would be a coin flip on some inputs.
    """
    needed, covered = 0, 1
    while covered < modulus:
        covered *= base
        needed += 1
    return needed


def smallest_unrepresentable(base: int, levels: int, modulus: int) -> int | None:
    """The smallest value below `modulus` that L levels cannot round-trip, or None.

    `base ** levels` exactly. Everything below it fits in L digits; that value is the first
    that does not, and `decompose` silently drops the overflow rather than complaining --
    which is the point. A system that truncates without saying so produces a recomposition
    that is confidently wrong.
    """
    reach = base**levels
    return reach if reach < modulus else None


# ---------------------------------------------------------------------------
# RGSW
# ---------------------------------------------------------------------------


def rgsw_encrypt(params: dict, secret, selector: int, material: dict) -> tuple:
    """`Z + selector * G`: 2L rows of (a, b), each an RLWE encryption of zero plus a gadget term.

    Rows below L put `gadget[j]` in the **a** slot; rows at or above L put `gadget[j - L]`
    in the **b** slot. That split is not decoration -- it is what makes `d . G` reassemble
    the ciphertext `(a, b)` in `external_product`, and dropping either half turns the
    product into something that decrypts to a fraction of the message.

    The returned rows carry the ciphertext and nothing else. Keeping the selector anywhere
    in the structure would let `external_product` branch on it, which is exactly the thing
    an encrypted selector exists to prevent.
    """
    if selector not in (0, 1):
        raise ValueError("the selector is a bit")
    levels, gadget = params["levels"], gadget_vector(params)
    rows = []
    for j in range(2 * levels):
        mask, noise = material["masks"][j], material["noises"][j]
        body = _add(params, ring_mul(params, mask, secret), noise)
        if j < levels:
            rows.append((_bump(params, mask, selector * gadget[j]), body))
        else:
            rows.append((_reduce(params, mask), _bump(params, body, selector * gadget[j - levels])))
    return tuple(rows)


def _add(params: dict, a, b) -> tuple[int, ...]:
    return ring_add(params, a, b)


def _reduce(params: dict, a) -> tuple[int, ...]:
    return tuple(int(x) % params["modulus"] for x in a)


def _bump(params: dict, poly, amount: int) -> tuple[int, ...]:
    """Add a scalar to the constant coefficient. The gadget term is a constant, not a shift."""
    out = list(poly)
    out[0] = (out[0] + amount) % params["modulus"]
    return tuple(out)


# ---------------------------------------------------------------------------
# The external product
# ---------------------------------------------------------------------------


def external_product(params: dict, rgsw, ciphertext: dict) -> dict:
    """`d . RGSW`, where d is the two decomposed halves of the ciphertext concatenated.

    No secret, by design. The selector is encrypted, and the whole point is that the result
    comes out right without anyone learning which way it went: `d . (Z + mu G)` is
    `RLWE(0) + mu * (a, b)`, so selector 0 yields an encryption of zero and selector 1
    yields the message back, and the arithmetic is identical either way.
    """
    digits = _digit_vector(params, ciphertext)
    left = right = tuple([0] * params["degree"])
    for j in range(2 * params["levels"]):
        left = ring_add(params, left, ring_mul(params, digits[j], rgsw[j][0]))
        right = ring_add(params, right, ring_mul(params, digits[j], rgsw[j][1]))
    return {"a": left, "b": right}


def _digit_vector(params: dict, ciphertext: dict) -> list:
    """`decompose(a) ++ decompose(b)`, in that order, matching the row layout."""
    return list(decompose_poly(params, ciphertext["a"])) + list(
        decompose_poly(params, ciphertext["b"])
    )


def external_trace(params: dict, rgsw, ciphertext: dict) -> tuple[dict, ...]:
    """One record per row, so the accumulation can be read rather than trusted.

    The last record's accumulator is the product itself -- the trace is the computation,
    not a commentary on it.
    """
    digits = _digit_vector(params, ciphertext)
    left = right = tuple([0] * params["degree"])
    records = []
    for j in range(2 * params["levels"]):
        partial_a = ring_mul(params, digits[j], rgsw[j][0])
        partial_b = ring_mul(params, digits[j], rgsw[j][1])
        left = ring_add(params, left, partial_a)
        right = ring_add(params, right, partial_b)
        records.append(
            {
                "row": j,
                "slot": "a" if j < params["levels"] else "b",
                "level": j if j < params["levels"] else j - params["levels"],
                "digits": digits[j],
                "partial_a": partial_a,
                "partial_b": partial_b,
                "accumulated_a": left,
                "accumulated_b": right,
            }
        )
    return tuple(records)
