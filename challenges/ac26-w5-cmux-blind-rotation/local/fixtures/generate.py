"""Parameters, the supplied ring/RLWE/RGSW layer, and the ground truth for this problem.

Nothing here is copied from the course's toy TFHE exercise: no function names, no fixtures,
no skeleton. Parameters come from the seed and every convention is written out below, so a
learner who has read the official material gains no shortcut.

The ring, RLWE, the gadget, RGSW and the **external product are supplied**. They are
`ac26-w5-lwe-rlwe` and `ac26-w5-rgsw-external`'s output, and re-deriving them is not what
this problem is about. This problem is CMUX, monomial rotation, and the blind rotation loop
that chains them.

## The encoding, fixed

    plaintext_modulus = 4      delta = q // 4      encode(m) = m * delta

Four, not two, and that is load-bearing. Negacyclic rotation negates a coefficient every
time it wraps past degree N, and with a plaintext modulus of two `-delta == delta (mod q)`:
the sign flip would be **invisible**, and an implementation that ignored `X^N = -1`
completely would score full marks. With four, negation maps `m -> (-m) mod 4`, which moves
1 and 3.

## Rotation, fixed

    X^(2N) = 1                 so an exponent is normalized modulo 2N, not modulo N
    X^N = -1                   so one wrap flips the sign, two wraps restore it

`monomial_rotate(poly, k)` is `X^k * poly` in `Z_q[X]/(X^N+1)`: coefficient i lands at
`(i + k) mod N`, negated when `((i + k) // N)` is odd. A negative k is normalized first;
`X^-1` is `X^(2N-1)`, not an error.

## Blind rotation, fixed

A toy LWE sample is `(mask, body)` over `Z_(2N)` -- already in the exponent's modulus, so
the modulus switch a real bootstrap needs is out of scope here:

    phase = (body - sum(mask[i] * secret[i])) mod 2N

`blind_rotate` computes `X^(-phase) * accumulator` **without ever learning phase**:

    ACC = X^(-body) * accumulator                       body is public; no CMUX needed
    for i:  ACC = CMUX(bk[i], ACC, X^(mask[i]) * ACC)   bk[i] = RGSW(secret[i])

Each CMUX multiplies in `X^(mask[i])` exactly when `secret[i]` is 1, so the product over
the loop is `X^(sum(mask[i] * secret[i]))` and the whole thing lands on
`X^(-body + <mask, secret>) = X^(-phase)`. Nothing branches: both candidates are computed
every round and the encrypted bit selects between them arithmetically.

Noise: every CMUX adds one external product's worth, `2 * L * N * (B-1) * NOISE_RANGE`, and
the rotations only permute and negate coefficients. Over an `n`-coefficient mask that is
`n` times the per-CMUX term, which is why the accumulator starts as a **trivial** ciphertext
(`a = 0`, `b = encoded`) carrying no noise at all. `VIABLE` is enumerated rather than
sampled so that total always fits, and `scripts/ac26-w5-cmux-blind-rotation.test.ts` checks
the arithmetic rather than trusting this paragraph.

None of this is secure. The parameters are small enough to enumerate and the secret falls
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

import hashlib

#: (base, levels, degree, lwe_dimension) whose blind-rotation noise provably fits the budget.
#: Enumerated rather than sampled: most combinations do not fit, and a parameter set that
#: silently exceeded the budget would make a correct submission fail.
VIABLE = (
    (2, 12, 2, 3),
    (2, 13, 4, 3),
    (2, 13, 4, 4),
    (2, 14, 4, 4),
    (2, 14, 8, 3),
    (4, 6, 2, 3),
    (4, 7, 4, 3),
    (4, 7, 4, 4),
    (4, 7, 8, 3),
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
    base, levels, degree, dimension = VIABLE[_pick(s, 0, 0, len(VIABLE) - 1)]
    modulus = base**levels
    plaintext_modulus = 4
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "modulus": modulus,
        "plaintext_modulus": plaintext_modulus,
        "delta": modulus // plaintext_modulus,
    }


def noise_bound(par: dict) -> int:
    """The most the accumulator's noise can be after a full blind rotation.

    One external product per CMUX, `dimension` CMUXes, and the accumulator starts noiseless.
    The rotations contribute nothing: they permute and negate coefficients.
    """
    per_cmux = 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE
    return par["dimension"] * per_cmux


# ---------------------------------------------------------------------------
# Supplied: the ring and the encoding
# ---------------------------------------------------------------------------


def normalize(par: dict, coefficients) -> tuple[int, ...]:
    """Fold a raw coefficient list into `Z_q[X]/(X^N+1)`.

    Index `i` beyond the degree wraps to `i % N` with the sign `(-1)^(i // N)`. That is the
    whole negacyclic rule, and monomial rotation is nothing more than this applied to a list
    that has been shifted right by the exponent.
    """
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
# Supplied: the gadget and RGSW (ac26-w5-rgsw-external's output)
# ---------------------------------------------------------------------------


def gadget_vector(par: dict) -> tuple[int, ...]:
    return tuple(par["base"] ** i for i in range(par["levels"]))


def decompose(par: dict, value: int) -> tuple[int, ...]:
    base, remaining = par["base"], value % par["modulus"]
    digits = []
    for _ in range(par["levels"]):
        digits.append(remaining % base)
        remaining //= base
    return tuple(digits)


def decompose_poly(par: dict, poly) -> tuple[tuple[int, ...], ...]:
    per_coefficient = [decompose(par, c) for c in _pad(par, poly)]
    return tuple(
        tuple(per_coefficient[k][i] for k in range(par["degree"]))
        for i in range(par["levels"])
    )


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


def rlwe_trivial(par: dict, messages) -> dict:
    """A ciphertext of `messages` with no mask and no noise: `a = 0`, `b = encoded`.

    It decrypts under every secret, which is exactly why the accumulator starts here -- the
    test vector is public, and starting it noiseless is what leaves the whole noise budget
    to the CMUXes.
    """
    return {
        "a": tuple([0] * par["degree"]),
        "b": normalize(par, [encode(par, m) for m in _pad(par, messages)]),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return tuple(decode(par, value) for value in rlwe_phase(par, secret, ciphertext))


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
                (
                    normalize(par, mask),
                    normalize(par, [body[0] + selector * gadget[j - levels], *body[1:]]),
                )
            )
    return tuple(rows)


def external_product(par: dict, rgsw, ciphertext: dict) -> dict:
    """`d . RGSW`, with `d` the two decomposed halves concatenated. No secret, by design."""
    digits = list(decompose_poly(par, ciphertext["a"])) + list(
        decompose_poly(par, ciphertext["b"])
    )
    left = right = tuple([0] * par["degree"])
    for j in range(2 * par["levels"]):
        left = ring_add(par, left, ring_mul(par, digits[j], rgsw[j][0]))
        right = ring_add(par, right, ring_mul(par, digits[j], rgsw[j][1]))
    return {"a": left, "b": right}


# ---------------------------------------------------------------------------
# Supplied: the ciphertext digest the trace reports
# ---------------------------------------------------------------------------


def digest(par: dict, ciphertext: dict) -> str:
    """A short, stable fingerprint of a ciphertext. Supplied so the format is not guesswork.

    It is a hash of the ciphertext, so two ciphertexts that decrypt to the same plaintext
    still have different digests. That is the point: a CMUX output that shares a digest with
    one of its candidates is that candidate, which is the shape of a plaintext branch.
    """
    payload = ":".join(
        str(value) for value in (*_pad(par, ciphertext["a"]), *_pad(par, ciphertext["b"]))
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# The LWE sample and the bootstrapping key, as ground truth
# ---------------------------------------------------------------------------


def lwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """The bits the bootstrapping key encrypts. Never all zero."""
    s = _stream(seed, f"lwe-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["dimension"] - 1)] = 1
    return tuple(bits)


def lwe_sample(seed: str, par: dict, secret, label: str = "public") -> dict:
    """`(mask, body)` over `Z_(2N)`, with `body = <mask, secret> + phase`.

    The phase is drawn rather than derived so the reference model has something definite to
    compare against, and the mask is drawn independently -- an all-zero mask would make the
    loop trivial.
    """
    modulus = 2 * par["degree"]
    s = _stream(seed, f"lwe-sample:{label}")
    mask = tuple(_pick(s, 2 * i, 0, modulus - 1) for i in range(par["dimension"]))
    phase = _pick(s, 200, 0, modulus - 1)
    body = (sum(m * k for m, k in zip(mask, secret)) + phase) % modulus
    return {"mask": mask, "body": body, "modulus": modulus}


def lwe_phase(par: dict, secret, sample: dict) -> int:
    """`(body - <mask, secret>) mod 2N` -- the exponent blind rotation lands on, negated."""
    inner = sum(m * k for m, k in zip(sample["mask"], secret))
    return (sample["body"] - inner) % sample["modulus"]


def bootstrap_key(seed: str, par: dict, ring_secret, bits, label: str = "public") -> tuple:
    """One RGSW per LWE secret bit, all encrypted under the same ring secret.

    That is the key's whole job: it carries the LWE secret into the ring so the loop can
    choose with it without decrypting it. Every row of every RGSW uses distinct randomness,
    so two keys for the same bits are different ciphertexts.
    """
    return tuple(
        rgsw_encrypt(par, ring_secret, bit, rgsw_material(seed, par, f"{label}:bk{i}"))
        for i, bit in enumerate(bits)
    )


def test_vector(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """The accumulator's starting plaintext. Not constant, or a rotation would be invisible.

    Coefficients are drawn from `{1, 3}` rather than all of `Z_4`: those are the two
    residues that move under negation, so every wrap past degree N shows up in the decoded
    result instead of only in the ciphertext.
    """
    s = _stream(seed, f"testvector:{label}")
    return tuple(1 + 2 * _pick(s, 2 * i, 0, 1) for i in range(par["degree"]))


# ---------------------------------------------------------------------------
# Ground truth: rotation, CMUX, blind rotation
# ---------------------------------------------------------------------------


def monomial_rotate(par: dict, poly, exponent: int) -> tuple[int, ...]:
    """`X^exponent * poly` in `Z_q[X]/(X^N+1)`, for any integer exponent."""
    shift = exponent % (2 * par["degree"])
    return normalize(par, [0] * shift + _pad(par, poly))


def rotate_ciphertext(par: dict, ciphertext: dict, exponent: int) -> dict:
    """Both halves rotate. `X^k * (a, b)` is still an encryption, of `X^k * m`."""
    return {
        "a": monomial_rotate(par, ciphertext["a"], exponent),
        "b": monomial_rotate(par, ciphertext["b"], exponent),
    }


def rlwe_add(par: dict, left: dict, right: dict) -> dict:
    return {
        "a": ring_add(par, left["a"], right["a"]),
        "b": ring_add(par, left["b"], right["b"]),
    }


def rlwe_sub(par: dict, left: dict, right: dict) -> dict:
    return {
        "a": ring_sub(par, left["a"], right["a"]),
        "b": ring_sub(par, left["b"], right["b"]),
    }


def cmux(par: dict, rgsw, ct0: dict, ct1: dict) -> dict:
    """`ct0 + RGSW(mu) * (ct1 - ct0)`. Selector 0 keeps ct0, selector 1 keeps ct1."""
    return rlwe_add(par, ct0, external_product(par, rgsw, rlwe_sub(par, ct1, ct0)))


def conditional_rotate(par: dict, rgsw, ciphertext: dict, exponent: int) -> dict:
    """Rotate if the encrypted bit is 1, hold if it is 0 -- and compute both either way."""
    return cmux(par, rgsw, ciphertext, rotate_ciphertext(par, ciphertext, exponent))


def blind_rotate(par: dict, key, sample: dict, accumulator: dict) -> dict:
    """`X^(-phase) * accumulator`, reached without ever learning phase."""
    current = rotate_ciphertext(par, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = conditional_rotate(par, key[index], current, mask)
    return current


def blind_rotate_trace(par: dict, key, sample: dict, accumulator: dict) -> tuple[dict, ...]:
    """One record per step, the first being the public offset rotation.

    `body` is public -- only the secret is not -- so step 0 has no encrypted choice and its
    two candidates are the same ciphertext. Every later step is a real CMUX, and its output
    is a fresh ciphertext that matches neither candidate.
    """
    modulus = 2 * par["degree"]
    rotated = rotate_ciphertext(par, accumulator, -sample["body"])
    records = [
        {
            "step": 0,
            "mask": sample["body"],
            "exponent": (-sample["body"]) % modulus,
            "selector": "phase-offset",
            "candidate0": digest(par, rotated),
            "candidate1": digest(par, rotated),
            "output": digest(par, rotated),
        }
    ]
    current = rotated
    for index, mask in enumerate(sample["mask"]):
        candidate1 = rotate_ciphertext(par, current, mask)
        output = cmux(par, key[index], current, candidate1)
        records.append(
            {
                "step": index + 1,
                "mask": mask,
                "exponent": mask % modulus,
                "selector": f"bk[{index}]",
                "candidate0": digest(par, current),
                "candidate1": digest(par, candidate1),
                "output": digest(par, output),
            }
        )
        current = output
    return tuple(records)


def reference_model(par: dict, secret, sample: dict, plaintext) -> tuple[int, ...]:
    """What blind rotation should land on, computed entirely in the clear.

    A separate model on purpose: comparing the loop against itself proves only that it is
    self-consistent, and a rotation direction that is reversed everywhere is exactly that.
    """
    phase = lwe_phase(par, secret, sample)
    rotated = monomial_rotate(par, [encode(par, m) for m in plaintext], -phase)
    return tuple(decode(par, value) for value in rotated)


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(
        f"health:{seed}:{par['base']}:{par['levels']}:{par['degree']}:{par['dimension']}".encode()
    ).hexdigest()[:16]
