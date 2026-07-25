"""Gadget parameters, the toy RLWE primitives, and the RGSW rows — all from FLAG_SEED.

Nothing here is copied from the course's toy TFHE exercise: no function names, no fixtures,
no skeleton. The parameters are generated from the seed and the conventions are written out
in full below, so a learner who has read the official material gains no shortcut.

The ring and the RLWE scheme are **supplied**. This problem is not about re-deriving them
-- `ac26-w5-lwe-rlwe` is -- so `ring_mul`, `rlwe_encrypt` and friends are here, correct, for
the learner to build on.

## The decomposition convention, fixed

    q = base ** levels                unsigned, LSB-first, exactly `levels` digits
    gadget = (1, B, B^2, ..., B^(L-1))
    decompose(x)  = the base-B digits of x mod q, least significant first
    recompose(d)  = sum(d[i] * gadget[i]) mod q

`q = base ** levels` is what makes recomposition **exact** for every value in `[0, q)`.
That is a choice, and the `failure` checkpoint is where it stops holding: give the same
base fewer levels than the modulus needs and some values stop round-tripping. Real
implementations use an approximate decomposition with a gadget of `q/B^i` and live with the
error; this one is exact so the error can be introduced deliberately rather than always
being present.

## RGSW, and why it has 2L rows

RGSW(mu) is `Z + mu * G`, where `Z` is 2L RLWE encryptions of zero stacked into a 2L x 2
matrix, and `G` is the gadget matrix:

    rows 0 .. L-1     put gadget[j]     in the **a** slot
    rows L .. 2L-1    put gadget[j-L]   in the **b** slot

The external product decomposes both halves of an RLWE ciphertext `(a, b)`, concatenates
the two digit vectors into one of length 2L, and multiplies it into the matrix:

    d = (decompose(a) ++ decompose(b))
    d . RGSW(mu) = d . Z + mu * (d . G) = RLWE(0) + mu * (a, b)

`d . G` reassembles `(a, b)` exactly -- that is the whole reason the rows are split across
the two slots -- so the result decrypts to `mu * m`. Selector 0 gives an encryption of
zero; selector 1 gives the message back. **Neither branch decrypts anything**, which is why
`external_product` is not given the secret.

Noise: the result carries `sum(d_j * e_j)` over 2L rows, bounded by `2 * L * N * (B-1)`
times the row noise. Every parameter set generated here is checked against the tolerated
interval, and `scripts/ac26-w5-rgsw-external.test.ts` asserts that it holds.

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

import hashlib

#: (base, levels, degree) triples whose external-product noise provably fits the budget.
#: Enumerated rather than sampled: most combinations do not fit, and a parameter set that
#: silently exceeds the budget would make a correct submission fail.
VIABLE = (
    (2, 7, 2),
    (2, 8, 2),
    (2, 9, 2),
    (2, 9, 4),
    (2, 10, 4),
    (4, 4, 2),
    (4, 5, 2),
    (4, 5, 4),
    (4, 6, 4),
)

#: Row noise stays in {-1, 0, 1}. Larger would need larger parameters for no extra lesson.
NOISE_RANGE = 1


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 512:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(s: list[int], i: int, low: int, high: int) -> int:
    return low + ((s[i % 500] * 256 + s[(i + 1) % 500]) % (high - low + 1))


def params(seed: str, label: str = "public") -> dict:
    s = _stream(seed, f"params:{label}")
    base, levels, degree = VIABLE[_pick(s, 0, 0, len(VIABLE) - 1)]
    modulus = base**levels
    plaintext_modulus = 2
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "modulus": modulus,
        "plaintext_modulus": plaintext_modulus,
        "delta": modulus // plaintext_modulus,
    }


def noise_bound(par: dict) -> int:
    """The most the external product's noise term can be, over 2L rows."""
    return 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE


# ---------------------------------------------------------------------------
# Supplied: the ring and the encoding (same conventions as ac26-w5-lwe-rlwe)
# ---------------------------------------------------------------------------


def normalize(par: dict, coefficients) -> tuple[int, ...]:
    n, q = par["degree"], par["modulus"]
    out = [0] * n
    for index, value in enumerate(coefficients):
        sign = -1 if (index // n) % 2 else 1
        out[index % n] = (out[index % n] + sign * value) % q
    return tuple(out)


def _pad(par: dict, coefficients) -> list[int]:
    values = list(coefficients)[: par["degree"]]
    return values + [0] * (par["degree"] - len(values))


def ring_add(par: dict, a, b) -> tuple[int, ...]:
    return normalize(par, [x + y for x, y in zip(_pad(par, a), _pad(par, b))])


def ring_sub(par: dict, a, b) -> tuple[int, ...]:
    return normalize(par, [x - y for x, y in zip(_pad(par, a), _pad(par, b))])


def ring_mul(par: dict, a, b) -> tuple[int, ...]:
    left, right = _pad(par, a), _pad(par, b)
    raw = [0] * (2 * par["degree"] - 1)
    for i, x in enumerate(left):
        for j, y in enumerate(right):
            raw[i + j] += x * y
    return normalize(par, raw)


def encode(par: dict, m: int) -> int:
    return (m % par["plaintext_modulus"]) * par["delta"] % par["modulus"]


def decode(par: dict, c: int) -> int:
    delta = par["delta"]
    return ((c % par["modulus"]) + delta // 2) // delta % par["plaintext_modulus"]


def centered(par: dict, x: int) -> int:
    q = par["modulus"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


# ---------------------------------------------------------------------------
# The gadget, as ground truth
# ---------------------------------------------------------------------------


def gadget_vector(par: dict) -> tuple[int, ...]:
    return tuple(par["base"] ** i for i in range(par["levels"]))


def decompose(par: dict, value: int) -> tuple[int, ...]:
    """Unsigned base-B digits of `value mod q`, least significant first, exactly L of them."""
    base, remaining = par["base"], value % par["modulus"]
    digits = []
    for _ in range(par["levels"]):
        digits.append(remaining % base)
        remaining //= base
    return tuple(digits)


def recompose(par: dict, digits) -> int:
    return sum(d * g for d, g in zip(digits, gadget_vector(par))) % par["modulus"]


def decompose_poly(par: dict, poly) -> tuple[tuple[int, ...], ...]:
    """`levels` polynomials. Level i holds digit i of every coefficient, order preserved."""
    per_coefficient = [decompose(par, c) for c in _pad(par, poly)]
    return tuple(
        tuple(per_coefficient[k][i] for k in range(par["degree"]))
        for i in range(par["levels"])
    )


def recompose_poly(par: dict, levels) -> tuple[int, ...]:
    gadget = gadget_vector(par)
    return normalize(
        par,
        [
            sum(levels[i][k] * gadget[i] for i in range(par["levels"]))
            for k in range(par["degree"])
        ],
    )


def levels_needed(base: int, modulus: int) -> int:
    """How many base-B digits it takes to represent every value in [0, modulus)."""
    needed, covered = 0, 1
    while covered < modulus:
        covered *= base
        needed += 1
    return needed


def smallest_unrepresentable(base: int, levels: int, modulus: int) -> int | None:
    """The smallest value in [0, modulus) that L levels cannot round-trip, or None.

    It is `base ** levels`: everything below fits in L digits, and that value is the first
    that needs one more. None when the levels are sufficient.
    """
    reach = base**levels
    return reach if reach < modulus else None


# ---------------------------------------------------------------------------
# Supplied: toy RLWE
# ---------------------------------------------------------------------------


def rlwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """0/1 coefficients, never all zero -- an all-zero secret degenerates the scheme."""
    s = _stream(seed, f"secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["degree"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["degree"] - 1)] = 1
    return tuple(bits)


def ring_random(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"mask:{label}")
    return tuple(_pick(s, 2 * i, 0, par["modulus"] - 1) for i in range(par["degree"]))


def ring_noise(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"noise:{label}")
    return tuple(_pick(s, 2 * i, -NOISE_RANGE, NOISE_RANGE) for i in range(par["degree"]))


def rlwe_encrypt(par: dict, secret, messages, mask, noise) -> dict:
    product = ring_mul(par, mask, secret)
    encoded = [encode(par, m) for m in _pad(par, messages)]
    return {
        "a": normalize(par, mask),
        "b": normalize(
            par, [p + e + n for p, e, n in zip(product, encoded, _pad(par, noise))]
        ),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return tuple(decode(par, value) for value in rlwe_phase(par, secret, ciphertext))


# ---------------------------------------------------------------------------
# RGSW and the external product, as ground truth
# ---------------------------------------------------------------------------


def rgsw_material(seed: str, par: dict, label: str) -> dict:
    """The randomness an RGSW encryption consumes: one mask and one noise per row."""
    rows = 2 * par["levels"]
    return {
        "masks": tuple(ring_random(seed, par, f"{label}:m{j}") for j in range(rows)),
        "noises": tuple(ring_noise(seed, par, f"{label}:n{j}") for j in range(rows)),
    }


def rgsw_encrypt(par: dict, secret, selector: int, material: dict) -> tuple:
    """2L rows of (a, b). Rows below L carry the gadget in `a`, rows above it in `b`."""
    levels, gadget = par["levels"], gadget_vector(par)
    rows = []
    for j in range(2 * levels):
        mask, noise = material["masks"][j], material["noises"][j]
        body = normalize(
            par, [x + y for x, y in zip(ring_mul(par, mask, secret), _pad(par, noise))]
        )
        if j < levels:
            rows.append(
                (normalize(par, [mask[0] + selector * gadget[j], *mask[1:]]), body)
            )
        else:
            rows.append(
                (normalize(par, mask), normalize(par, [body[0] + selector * gadget[j - levels], *body[1:]]))
            )
    return tuple(rows)


def external_product(par: dict, rgsw, ciphertext: dict) -> dict:
    digits = list(decompose_poly(par, ciphertext["a"])) + list(
        decompose_poly(par, ciphertext["b"])
    )
    left = right = tuple([0] * par["degree"])
    for j in range(2 * par["levels"]):
        left = ring_add(par, left, ring_mul(par, digits[j], rgsw[j][0]))
        right = ring_add(par, right, ring_mul(par, digits[j], rgsw[j][1]))
    return {"a": left, "b": right}


def external_trace(par: dict, rgsw, ciphertext: dict) -> tuple[dict, ...]:
    """One record per row: which slot the gadget sits in, the digits used, the running sum."""
    digits = list(decompose_poly(par, ciphertext["a"])) + list(
        decompose_poly(par, ciphertext["b"])
    )
    left = right = tuple([0] * par["degree"])
    out = []
    for j in range(2 * par["levels"]):
        partial_a = ring_mul(par, digits[j], rgsw[j][0])
        partial_b = ring_mul(par, digits[j], rgsw[j][1])
        left = ring_add(par, left, partial_a)
        right = ring_add(par, right, partial_b)
        out.append(
            {
                "row": j,
                "slot": "a" if j < par["levels"] else "b",
                "level": j if j < par["levels"] else j - par["levels"],
                "digits": digits[j],
                "partial_a": partial_a,
                "partial_b": partial_b,
                "accumulated_a": left,
                "accumulated_b": right,
            }
        )
    return tuple(out)


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(
        f"health:{seed}:{par['base']}:{par['levels']}:{par['degree']}".encode()
    ).hexdigest()[:16]
