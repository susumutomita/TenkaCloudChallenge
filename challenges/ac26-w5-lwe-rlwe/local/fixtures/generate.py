"""Parameters, secrets, samples — all derived from FLAG_SEED, and the ground truth.

Nothing here is copied from the course's toy TFHE exercise. The parameters come from the
seed and every rule this problem grades is stated in full below, so a learner who has read
the official material gains no shortcut and a learner who has not loses nothing. Same seed,
same parameters (a session is reproducible); different seed, different parameters (somebody
else's answer does not carry).

The whole model:

    the ring          R_q = Z_q[X] / (X^N + 1)        <- note the PLUS
    the fold          X^N = -1, so a coefficient that walks off the top comes back negated
    a message         m in [0, p), or N of them as a polynomial
    the scaling       q = p * D, encode(m) = (m * D) mod q      <- carried from problem 510
    an LWE secret     s, a vector of n small integers in {-1, 0, 1}
    an LWE sample     (a, b) with b = <a, s> + encode(m) + e    (mod q)
    an RLWE secret    s, a polynomial with N small coefficients
    an RLWE sample    (a, b) with b = a*s + encode(m) + e       in R_q
    the phase         b - <a, s>, or b - a*s: what is left once the secret cancels
    decryption        decode(phase), which is problem 510's nearest-point rule

The one structural fact worth stating twice: the ring is negacyclic. Multiplying with an
ordinary convolution and reducing the length is a *different ring*, it decrypts correctly
on plenty of inputs, and telling the two apart is the first checkpoint's whole job.

None of this is secure. `q` is small enough to enumerate and the secret is short enough to
search, which is the only reason the intermediate values are printable at all. A real
parameter set hides the secret behind a lattice problem; this one hides it behind nothing.
"""

from __future__ import annotations

import hashlib

#: Plaintext moduli small enough to enumerate every message by hand.
PLAINTEXT_MODULI = (2, 4)

#: Ring degrees. Both are powers of two, because X^N + 1 is the cyclotomic that makes the
#: negacyclic fold exact; neither is large enough to need an NTT.
DEGREES = (4, 8)


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 64:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 60] * 256 + s[(i + 1) % 60]) % (high - low + 1))


def params(seed: str, label: str = "public") -> dict:
    """One consistent parameter set.

    `degree` and `dimension` are drawn separately and are usually different numbers. That
    is deliberate: an implementation that quietly assumes the LWE dimension equals the ring
    degree works on any parameter set where they happen to coincide.
    """
    s = _stream(seed, f"params:{label}")
    p = PLAINTEXT_MODULI[_pick(s, 0, 0, len(PLAINTEXT_MODULI) - 1)]
    delta = _pick(s, 4, 6, 33)
    degree = DEGREES[_pick(s, 8, 0, len(DEGREES) - 1)]
    dimension = _pick(s, 12, 3, 6)
    return {"p": p, "delta": delta, "q": p * delta, "degree": degree, "dimension": dimension}


# --------------------------------------------------------------------------------------
# Carried over from problem 510. These are given to the learner already written, because
# re-deriving them is not what this problem is about -- spending the budget they define is.
# --------------------------------------------------------------------------------------


def encode(par: dict, m: int) -> int:
    return (m % par["p"]) * par["delta"] % par["q"]


def decode(par: dict, c: int) -> int:
    delta = par["delta"]
    return ((c % par["q"]) + delta // 2) // delta % par["p"]


def centered(par: dict, x: int) -> int:
    q = par["q"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def noise_interval(par: dict) -> tuple[int, int]:
    delta = par["delta"]
    return (-(delta // 2), delta - delta // 2 - 1)


# --------------------------------------------------------------------------------------
# The ring.
# --------------------------------------------------------------------------------------


def normalize(par: dict, coefficients) -> tuple[int, ...]:
    """The canonical element of R_q for any integer sequence, of any length.

    Two things happen and they are independent. Degrees at or above N fold back down, with
    the sign flipping once per full turn because X^N = -1 — so index 2N lands on index 0
    with a PLUS, not a minus. And every coefficient reduces into [0, q).
    """
    n, q = par["degree"], par["q"]
    folded = [0] * n
    for index, value in enumerate(coefficients):
        sign = -1 if (index // n) % 2 else 1
        folded[index % n] += sign * value
    return tuple(value % q for value in folded)


def ring_add(par: dict, f, g) -> tuple[int, ...]:
    left, right = normalize(par, f), normalize(par, g)
    return normalize(par, [a + b for a, b in zip(left, right)])


def ring_sub(par: dict, f, g) -> tuple[int, ...]:
    left, right = normalize(par, f), normalize(par, g)
    return normalize(par, [a - b for a, b in zip(left, right)])


def ring_mul(par: dict, f, g) -> tuple[int, ...]:
    """Negacyclic product. The convolution is ordinary; `normalize` does the folding."""
    left, right = normalize(par, f), normalize(par, g)
    raw = [0] * (2 * len(left) - 1)
    for i, a in enumerate(left):
        for j, b in enumerate(right):
            raw[i + j] += a * b
    return normalize(par, raw)


def cyclic_mul(par: dict, f, g) -> tuple[int, ...]:
    """The wrong ring, kept here on purpose.

    `X^N = +1` instead of `-1`. It agrees with `ring_mul` on plenty of inputs, which is why
    a counterexample is worth more than an argument. `make inspect` prints one.
    """
    n, q = par["degree"], par["q"]
    left, right = normalize(par, f), normalize(par, g)
    out = [0] * n
    for i, a in enumerate(left):
        for j, b in enumerate(right):
            out[(i + j) % n] += a * b
    return tuple(value % q for value in out)


# --------------------------------------------------------------------------------------
# LWE and RLWE.
# --------------------------------------------------------------------------------------


def lwe_encrypt(par: dict, secret, message: int, mask, error: int) -> tuple:
    """(a, b) with b = <a, s> + encode(m) + e. Randomness is supplied, not drawn."""
    q = par["q"]
    body = (sum(a * s for a, s in zip(mask, secret)) + encode(par, message) + error) % q
    return (tuple(a % q for a in mask), body)


def lwe_phase(par: dict, secret, ciphertext) -> int:
    """What is left once the secret cancels: encode(m) + e, reduced into [0, q)."""
    mask, body = ciphertext
    return (body - sum(a * s for a, s in zip(mask, secret))) % par["q"]


def lwe_decrypt(par: dict, secret, ciphertext) -> int:
    return decode(par, lwe_phase(par, secret, ciphertext))


def rlwe_encrypt(par: dict, secret, message, mask, error) -> tuple:
    """The same three terms, with every scalar replaced by a polynomial."""
    product = ring_mul(par, mask, secret)
    encoded = [encode(par, m) for m in message]
    body = normalize(par, [x + y + z for x, y, z in zip(product, encoded, error)])
    return (normalize(par, mask), body)


def rlwe_phase(par: dict, secret, ciphertext) -> tuple[int, ...]:
    mask, body = ciphertext
    return ring_sub(par, body, ring_mul(par, mask, secret))


def rlwe_decrypt(par: dict, secret, ciphertext) -> tuple[int, ...]:
    return tuple(decode(par, c) for c in rlwe_phase(par, secret, ciphertext))


def phase_coefficient_terms(par: dict, mask, k: int) -> tuple[int, ...]:
    """The vector v with <v, s> = (mask * s)[k] for EVERY secret s.

    This is where the two constructions meet. One RLWE ciphertext carries N coefficients
    and each one is an inner product against the same secret — so it is N LWE-shaped
    equations that share a mask, rather than N independent samples. The sign is the ring's
    fingerprint: the terms that had to walk past degree N to reach coefficient k come back
    negated, and that is the only thing distinguishing this from a cyclic rotation.
    """
    n, q = par["degree"], par["q"]
    coefficients = normalize(par, mask)
    return tuple(
        (coefficients[k - j] if j <= k else -coefficients[k + n - j]) % q for j in range(n)
    )


# --------------------------------------------------------------------------------------
# The noise budget, generalized from one number to N of them.
# --------------------------------------------------------------------------------------


def survives(par: dict, error) -> bool:
    """Whether decryption still returns the message, given this noise.

    An int is one coefficient's worth; a sequence is a whole polynomial's. A polynomial
    survives when EVERY coefficient does. The mean, the sum, and the total magnitude are
    all irrelevant — one coefficient over the edge loses that coefficient's message, and
    the ciphertext carries all N of them.
    """
    low, high = noise_interval(par)
    values = (error,) if isinstance(error, int) else tuple(error)
    return all(low <= value <= high for value in values)


def first_failing_index(par: dict, samples) -> int:
    """The index of the first sample that does not survive, or -1 when none fail."""
    for index, error in enumerate(samples):
        if not survives(par, error):
            return index
    return -1


def validate_ciphertext(par: dict, mode: str, ciphertext) -> list[str]:
    """Reasons this object cannot be a ciphertext of that kind, empty when it can.

    Canonical means every coefficient is already in [0, q). A ciphertext arriving with a
    negative coefficient, or with q itself, is not "nearly right" — it is a value that two
    implementations will disagree about, and the disagreement surfaces as a decryption
    failure a long way from here.
    """
    failures: list[str] = []
    if mode not in ("lwe", "rlwe"):
        return [f"unknown ciphertext mode {mode!r}"]
    if not isinstance(ciphertext, (tuple, list)) or len(ciphertext) != 2:
        return ["a ciphertext is a (mask, body) pair"]
    mask, body = ciphertext
    q, expected = par["q"], par["degree"] if mode == "rlwe" else par["dimension"]

    def coefficients(value, name: str) -> list[int] | None:
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


# --------------------------------------------------------------------------------------
# Seed-derived material.
# --------------------------------------------------------------------------------------


def secret(seed: str, label: str, length: int) -> tuple[int, ...]:
    """A small ternary secret: coefficients in {-1, 0, 1}.

    Negative entries are the point. They make the reduction into [0, q) load-bearing rather
    than decorative, and they are what a real small secret looks like.
    """
    s = _stream(seed, f"secret:{label}")
    return tuple(_pick(s, 2 * i, -1, 1) for i in range(length))


def raw_sequence(seed: str, label: str, length: int, low: int, high: int) -> tuple[int, ...]:
    """An arbitrary integer sequence. Used for inputs that are not yet ring elements."""
    s = _stream(seed, f"raw:{label}")
    return tuple(_pick(s, 2 * i, low, high) for i in range(length))


def ring_element(par: dict, seed: str, label: str) -> tuple[int, ...]:
    return raw_sequence(seed, f"ring:{label}", par["degree"], 0, par["q"] - 1)


# The case builders take `par` rather than deriving it, so a synthesized parameter set --
# the one the hidden suite adds when a seed happens to draw six odd deltas, say -- gets
# cases too. Deriving it here would silently hand back cases for a different ring.


def lwe_case(par: dict, seed: str, label: str, index: int) -> dict:
    s = _stream(seed, f"lwe:{label}:{index}")
    low, high = noise_interval(par)
    return {
        "secret": secret(seed, f"lwe:{label}", par["dimension"]),
        "message": _pick(s, 0, 0, par["p"] - 1),
        "mask": tuple(_pick(s, 4 + 2 * i, 0, par["q"] - 1) for i in range(par["dimension"])),
        "error": _pick(s, 32, low, high),
    }


def rlwe_case(par: dict, seed: str, label: str, index: int) -> dict:
    s = _stream(seed, f"rlwe:{label}:{index}")
    n = par["degree"]
    low, high = noise_interval(par)
    return {
        "secret": secret(seed, f"rlwe:{label}", n),
        "message": tuple(_pick(s, 2 * i, 0, par["p"] - 1) for i in range(n)),
        "mask": tuple(_pick(s, 20 + 2 * i, 0, par["q"] - 1) for i in range(n)),
        "error": tuple(_pick(s, 40 + 2 * i, low, high) for i in range(n)),
    }


def boundary_samples(par: dict, seed: str, label: str) -> tuple:
    """Noise values, mixed scalars and polynomials, with exactly one first failure.

    The sample that fails first is built so its mean is comfortable and its maximum is not:
    one coefficient is a single step past the top of the budget and another is pulled to the
    bottom. Anything that scores a polynomial by its sum, its mean, or its magnitude walks
    straight past it and reports a later index.
    """
    low, high = noise_interval(par)
    n = par["degree"]
    s = _stream(seed, f"boundary:{label}")
    hot = _pick(s, 0, 0, n - 1)
    cold = (hot + 1 + _pick(s, 4, 0, n - 2)) % n
    survivors: list = [
        _pick(s, 8, low, high),
        tuple(0 for _ in range(n)),
        high,
        tuple(high if i == hot else low for i in range(n)),
        low,
        tuple(_pick(s, 16 + 2 * i, low, high) for i in range(n)),
    ]
    killer = tuple(high + 1 if i == hot else (low if i == cold else 0) for i in range(n))
    lead = 1 + _pick(s, 44, 0, len(survivors) - 1)
    tail = [high + 1, tuple(low - 1 for _ in range(n)), low - 1]
    return tuple(survivors[:lead] + [killer] + survivors[lead:] + tail)


def surviving_samples(par: dict, seed: str, label: str) -> tuple:
    """A run with no failure in it at all, so -1 has to be reachable."""
    low, high = noise_interval(par)
    n = par["degree"]
    s = _stream(seed, f"surviving:{label}")
    return (
        low,
        high,
        0,
        tuple(0 for _ in range(n)),
        tuple(high for _ in range(n)),
        tuple(low for _ in range(n)),
        tuple(_pick(s, 2 * i, low, high) for i in range(n)),
    )


def invalid_ciphertexts(par: dict) -> tuple[tuple[str, str, object], ...]:
    """(reason, mode, ciphertext) triples that must be rejected.

    Fixed here rather than constructed by the learner: rejecting an object you broke
    yourself proves nothing about the validator.
    """
    n, q, dim = par["degree"], par["q"], par["dimension"]
    zeros_n = tuple(0 for _ in range(n))
    zeros_d = tuple(0 for _ in range(dim))
    return (
        ("an LWE mask carrying one coefficient too many", "lwe", (zeros_d + (0,), 0)),
        ("an LWE mask carrying one coefficient too few", "lwe", (zeros_d[:-1], 0)),
        ("an LWE coefficient equal to q, which is not in [0, q)", "lwe", ((q,) + zeros_d[1:], 0)),
        ("a negative LWE coefficient, which is not canonical", "lwe", ((-1,) + zeros_d[1:], 0)),
        ("an LWE body equal to q", "lwe", (zeros_d, q)),
        ("a boolean where an LWE coefficient belongs", "lwe", ((True,) + zeros_d[1:], 0)),
        ("an LWE body that is a polynomial", "lwe", (zeros_d, (0,))),
        ("an RLWE mask of the wrong degree", "rlwe", (zeros_n[:-1], zeros_n)),
        ("an RLWE body of the wrong degree", "rlwe", (zeros_n, zeros_n + (0,))),
        ("an RLWE body coefficient equal to q", "rlwe", (zeros_n, (q,) + zeros_n[1:])),
        ("an RLWE body that is a bare integer", "rlwe", (zeros_n, 0)),
        ("a ciphertext that is not a (mask, body) pair", "lwe", (zeros_d,)),
        ("a ciphertext mode this problem does not define", "rgsw", (zeros_d, 0)),
    )


def valid_ciphertexts(par: dict) -> tuple[tuple[str, object], ...]:
    """(mode, ciphertext) pairs that must be accepted.

    The `q - 1` entries are the ones an over-eager validator rejects: the top of the ring is
    a perfectly ordinary coefficient, and a bound written `< q - 1` or `<= q` loses one end
    or admits one value too many.
    """
    n, q, dim = par["degree"], par["q"], par["dimension"]
    return (
        ("lwe", (tuple(0 for _ in range(dim)), 0)),
        ("lwe", (tuple(q - 1 for _ in range(dim)), q - 1)),
        ("rlwe", (tuple(0 for _ in range(n)), tuple(0 for _ in range(n)))),
        ("rlwe", (tuple(q - 1 for _ in range(n)), tuple(0 for _ in range(n)))),
    )


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(f"health:{seed}:{par['q']}:{par['degree']}".encode()).hexdigest()[:16]
