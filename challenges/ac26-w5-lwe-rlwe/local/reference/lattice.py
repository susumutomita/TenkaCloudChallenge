"""Reference implementation. Lives inside the image only; never bind-mounted.

Used by two things: the mutation suite (which breaks copies of this file and asserts the
hidden tests catch each break), and the `reference-test` CI target.

Every function reads `params`. Nothing hardcodes a degree, a dimension, or a modulus,
because the `transfer` checkpoint runs the whole file under a parameter set derived from a
different seed -- and because a hardcoded degree is one of the mutations.

The four functions under "Given" are problem 510's answer, shipped already written. They
are not graded here. Everything below them is.
"""

from __future__ import annotations

# --------------------------------------------------------------------------------------
# Given: the encoding and the noise budget from problem 510.
# --------------------------------------------------------------------------------------


def encode(params: dict, m: int) -> int:
    return (m % params["p"]) * params["delta"] % params["q"]


def decode(params: dict, c: int) -> int:
    delta = params["delta"]
    return ((c % params["q"]) + delta // 2) // delta % params["p"]


def centered(params: dict, x: int) -> int:
    q = params["q"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def noise_interval(params: dict) -> tuple[int, int]:
    delta = params["delta"]
    return (-(delta // 2), delta - delta // 2 - 1)


# --------------------------------------------------------------------------------------
# The ring R_q = Z_q[X] / (X^N + 1).
# --------------------------------------------------------------------------------------


def normalize(params: dict, coefficients) -> tuple[int, ...]:
    """The canonical element of R_q for any integer sequence, of any length.

    Two independent things happen. Degree N folds onto degree 0 with a sign flip, because
    X^N = -1 -- and degree 2N folds back with the sign flipped again, so it lands positive.
    Writing the flip as "index >= N" instead of "(index // N) is odd" is right for one turn
    around the ring and wrong for every turn after it, which is exactly the range a
    convolution of two degree-(N-1) polynomials never reaches. It has to be tested with a
    longer input than a product can produce.

    The second thing is the reduction into [0, q). Python's `%` already returns a
    non-negative result for a positive modulus, so a negative coefficient needs no special
    case -- which matters here because the secrets really are negative.
    """
    n, q = params["degree"], params["q"]
    folded = [0] * n
    for index, value in enumerate(coefficients):
        sign = -1 if (index // n) % 2 else 1
        folded[index % n] += sign * value
    return tuple(value % q for value in folded)


def ring_add(params: dict, f, g) -> tuple[int, ...]:
    left, right = normalize(params, f), normalize(params, g)
    return normalize(params, [a + b for a, b in zip(left, right)])


def ring_sub(params: dict, f, g) -> tuple[int, ...]:
    left, right = normalize(params, f), normalize(params, g)
    return normalize(params, [a - b for a, b in zip(left, right)])


def ring_mul(params: dict, f, g) -> tuple[int, ...]:
    """The negacyclic product.

    The convolution itself is ordinary -- coefficient i of one times coefficient j of the
    other lands on i + j. What makes the ring negacyclic is what happens to the half of that
    result sitting above degree N, and `normalize` is where it happens. Reducing indices
    with `% N` here instead would be a cyclic convolution: a different ring, one that
    decrypts a great many samples correctly, and one no round-trip test notices.
    """
    left, right = normalize(params, f), normalize(params, g)
    raw = [0] * (2 * len(left) - 1)
    for i, a in enumerate(left):
        for j, b in enumerate(right):
            raw[i + j] += a * b
    return normalize(params, raw)


# --------------------------------------------------------------------------------------
# LWE, then the same three terms with every scalar replaced by a polynomial.
# --------------------------------------------------------------------------------------


def lwe_encrypt(params: dict, secret, message: int, mask, error: int) -> tuple:
    """(a, b) with b = <a, s> + encode(m) + e, reduced into [0, q).

    The mask and the noise are handed in rather than drawn. A toy that draws its own
    randomness cannot be graded against a fixture, and the security question this would
    raise -- where does `a` come from, and what happens when it repeats -- is not settled by
    calling a random number generator either.
    """
    q = params["q"]
    body = (sum(a * s for a, s in zip(mask, secret)) + encode(params, message) + error) % q
    return (tuple(a % q for a in mask), body)


def lwe_phase(params: dict, secret, ciphertext) -> int:
    """b - <a, s>: what is left once the secret cancels, which is encode(m) + e.

    The subtraction is the whole content. Adding instead gives b + <a, s>, which is a
    perfectly well-defined number that decodes to the right message whenever <a, s> happens
    to be 0 or a multiple of the scaling -- often enough to pass a test written from one
    example.
    """
    mask, body = ciphertext
    return (body - sum(a * s for a, s in zip(mask, secret))) % params["q"]


def lwe_decrypt(params: dict, secret, ciphertext) -> int:
    return decode(params, lwe_phase(params, secret, ciphertext))


def rlwe_encrypt(params: dict, secret, message, mask, error) -> tuple:
    """The LWE line with every scalar promoted to a polynomial.

    `message` is N messages and `error` is N noise coefficients, so every coefficient
    carries its own message and spends its own budget. Encoding only the constant term is
    the natural half-step from LWE and it leaves N-1 coefficients decoding to whatever the
    noise says.
    """
    product = ring_mul(params, mask, secret)
    encoded = [encode(params, m) for m in message]
    body = normalize(params, [x + y + z for x, y, z in zip(product, encoded, error)])
    return (normalize(params, mask), body)


def rlwe_phase(params: dict, secret, ciphertext) -> tuple[int, ...]:
    mask, body = ciphertext
    return ring_sub(params, body, ring_mul(params, mask, secret))


def rlwe_decrypt(params: dict, secret, ciphertext) -> tuple[int, ...]:
    return tuple(decode(params, c) for c in rlwe_phase(params, secret, ciphertext))


def phase_coefficient_terms(params: dict, mask, k: int) -> tuple[int, ...]:
    """The vector v with <v, s> = (mask * s)[k] for EVERY secret s.

    This is where the two constructions meet, and it is a stronger statement than "RLWE is
    LWE with longer vectors". One RLWE ciphertext holds N coefficients; each one is an inner
    product against the same secret, so it is N LWE-shaped equations sharing one mask rather
    than N independent samples.

    The coefficients arrive reversed, because coefficient k of a product pairs mask[k - j]
    with secret[j]. The terms with j > k are the ones whose index had to walk past degree N
    to arrive, and those come back negated. Drop the minus and this is a cyclic rotation of
    the mask -- which is a real vector, satisfying a real identity, in the wrong ring.
    """
    n, q = params["degree"], params["q"]
    coefficients = normalize(params, mask)
    return tuple(
        (coefficients[k - j] if j <= k else -coefficients[k + n - j]) % q for j in range(n)
    )


# --------------------------------------------------------------------------------------
# The budget from problem 510, generalized from one number to N of them.
# --------------------------------------------------------------------------------------


def survives(params: dict, error) -> bool:
    """Whether the message still comes back, given this noise.

    An int is one coefficient's worth of noise; a sequence is a whole polynomial's. A
    polynomial survives when EVERY coefficient survives. Not the sum, not the mean, not the
    magnitude: the ciphertext carries N messages, each one is decided by its own
    coefficient's distance from the rounding boundary, and one coefficient over the edge
    loses that message however comfortable the rest are.
    """
    low, high = noise_interval(params)
    values = (error,) if isinstance(error, int) else tuple(error)
    return all(low <= value <= high for value in values)


def first_failing_index(params: dict, samples) -> int:
    """The index of the first sample that does not survive, or -1 when none do fail."""
    for index, error in enumerate(samples):
        if not survives(params, error):
            return index
    return -1


def validate_ciphertext(params: dict, mode: str, ciphertext) -> list[str]:
    """Reasons this object cannot be a ciphertext of that kind, empty when it can.

    Two shapes, one function, and the shapes differ in more than a length: an LWE body is a
    single integer and an RLWE body is a polynomial. Canonical means every coefficient is
    already in [0, q) -- q itself is not "nearly zero" here, it is a value two
    implementations will silently disagree about.
    """
    failures: list[str] = []
    if mode not in ("lwe", "rlwe"):
        return [f"unknown ciphertext mode {mode!r}"]
    if not isinstance(ciphertext, (tuple, list)) or len(ciphertext) != 2:
        return ["a ciphertext is a (mask, body) pair"]
    mask, body = ciphertext
    q = params["q"]
    expected = params["degree"] if mode == "rlwe" else params["dimension"]

    def coefficients(value, name: str):
        if not isinstance(value, (tuple, list)):
            failures.append(f"the {name} is not a sequence of coefficients")
            return None
        if len(value) != expected:
            failures.append(f"the {name} has {len(value)} coefficients, not {expected}")
            return None
        return list(value)

    def canonical(values, name: str) -> None:
        for value in values:
            if not isinstance(value, int) or isinstance(value, bool):
                failures.append(f"a {name} coefficient is not an integer")
                return
            if not 0 <= value < q:
                failures.append(f"a {name} coefficient is outside [0, q)")
                return

    drawn = coefficients(mask, "mask")
    if drawn is not None:
        canonical(drawn, "mask")
    if mode == "rlwe":
        held = coefficients(body, "body")
        if held is not None:
            canonical(held, "body")
    elif not isinstance(body, int) or isinstance(body, bool):
        failures.append("an LWE body is a single integer")
    elif not 0 <= body < q:
        failures.append("the LWE body is outside [0, q)")
    return failures
