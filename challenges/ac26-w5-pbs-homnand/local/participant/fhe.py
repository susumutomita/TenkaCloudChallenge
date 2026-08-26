"""The supplied Week 5 stack: everything this problem hands the learner rather than grades.

Five problems' worth of machinery is supplied here: the ring and the encoding
(`ac26-w5-encoding-noise`), LWE and RLWE (`ac26-w5-lwe-rlwe`), the gadget, RGSW and the
external product (`ac26-w5-rgsw-external`), CMUX and monomial rotation
(`ac26-w5-cmux-blind-rotation`), and sample extraction and key switching
(`ac26-w5-extract-key-switch`). This problem is the pipeline that chains them, and the gate
it evaluates -- and none of *that* is in this file.

Issue 543/537: this module used to be part of `fixtures/generate.py`, which shipped in the
single participant Docker stage. `fixtures/generate.py` cannot derive a deployment's
parameters and traces without also implementing `lookup_accumulator`, `to_rotation_domain`,
`blind_rotate`, `output_noise_bound`, `correctness_bound`, `refresh_report` and
`nand_combine` -- seven of the names `starter/pipeline.py` asks the learner to write -- so
while the two lived together, every one of them was a single import away from the person
being graded. Option B2 splits the file along the line the problem already draws: the
supplied half ships to the participant, the graded half stays in the verifier image.

`starter/pipeline.py`, `show.py` and `tests/public/test_pipeline.py` import from here.
`fixtures/generate.py` imports from here too, so the arithmetic a learner builds on and the
one they are graded against cannot drift apart.

None of this is secure. The parameters are small enough to enumerate and both secrets fall
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

import hashlib

#: (base, levels, degree, dimension). The ring degree is also the extracted dimension; the
#: LWE dimension is both the input's and the output's, because the pipeline returns to the
#: key it started from. Enumerated rather than sampled: the domain switch costs up to
#: `(n+1)/2` rotation-domain units out of the `N/4` available, and the output noise has to
#: leave room for a second pass, so most combinations do not fit.
VIABLE = (
    (2, 18, 16, 3),
    (2, 18, 16, 4),
    (2, 19, 16, 4),
    (2, 18, 32, 3),
    (4, 9, 16, 3),
    (4, 9, 16, 4),
    (4, 10, 16, 4),
    (4, 9, 32, 3),
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
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "modulus": modulus,
        "plaintext_modulus": 2,
        "delta": modulus // 8,
        "parameterSetId": parameter_set_id(base, levels, degree, dimension),
        "encodingId": "balanced-eighth",
    }


def parameter_set_id(base: int, levels: int, degree: int, dimension: int) -> str:
    """A stable name for a parameter set, so an artifact can say which one it belongs to."""
    return f"B{base}-L{levels}-N{degree}-n{dimension}"


def blind_rotation_noise(par: dict) -> int:
    return par["dimension"] * 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE


def key_switch_noise(par: dict) -> int:
    return par["degree"] * par["levels"] * (par["base"] - 1) * NOISE_RANGE

# ---------------------------------------------------------------------------
# Supplied: the ring
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


def centered(par: dict, x: int) -> int:
    q = par["modulus"]
    value = x % q
    return value - q if value >= (q + 1) // 2 else value


def encode(par: dict, m: int) -> int:
    """`+q/8` for 1, `-q/8` for 0. Balanced, so decoding is a sign test."""
    return ((2 * (m % 2) - 1) * par["delta"]) % par["modulus"]


def decode(par: dict, c: int) -> int:
    return 1 if centered(par, c) > 0 else 0


# ---------------------------------------------------------------------------
# Supplied: the gadget, RGSW, the external product, CMUX, rotation
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


def ring_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    s = _stream(seed, f"ring-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["degree"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["degree"] - 1)] = 1
    return tuple(bits)


def lwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    s = _stream(seed, f"lwe-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["dimension"] - 1)] = 1
    return tuple(bits)


def ring_random(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"mask:{label}")
    return tuple(_pick(s, 2 * i, 0, par["modulus"] - 1) for i in range(par["degree"]))


def ring_noise(seed: str, par: dict, label: str) -> tuple[int, ...]:
    s = _stream(seed, f"noise:{label}")
    return tuple(_pick(s, 2 * i, -NOISE_RANGE, NOISE_RANGE) for i in range(par["degree"]))


def rgsw_material(seed: str, par: dict, label: str) -> dict:
    rows = 2 * par["levels"]
    return {
        "masks": tuple(ring_random(seed, par, f"{label}:m{j}") for j in range(rows)),
        "noises": tuple(ring_noise(seed, par, f"{label}:n{j}") for j in range(rows)),
    }


def rgsw_encrypt(par: dict, secret, selector: int, material: dict) -> tuple:
    levels, gadget = par["levels"], gadget_vector(par)
    rows = []
    for j in range(2 * levels):
        mask, noise = material["masks"][j], material["noises"][j]
        body = normalize(
            par, [x + y for x, y in zip(ring_mul(par, mask, secret), _pad(par, noise))]
        )
        if j < levels:
            rows.append((normalize(par, [mask[0] + selector * gadget[j], *mask[1:]]), body))
        else:
            rows.append(
                (
                    normalize(par, mask),
                    normalize(par, [body[0] + selector * gadget[j - levels], *body[1:]]),
                )
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


def cmux(par: dict, rgsw, ct0: dict, ct1: dict) -> dict:
    difference = {
        "a": ring_sub(par, ct1["a"], ct0["a"]),
        "b": ring_sub(par, ct1["b"], ct0["b"]),
    }
    product = external_product(par, rgsw, difference)
    return {
        "a": ring_add(par, ct0["a"], product["a"]),
        "b": ring_add(par, ct0["b"], product["b"]),
    }


def monomial_rotate(par: dict, poly, exponent: int) -> tuple[int, ...]:
    return normalize(par, [0] * (exponent % (2 * par["degree"])) + _pad(par, poly))


def rotate_ciphertext(par: dict, ciphertext: dict, exponent: int) -> dict:
    return {
        "a": monomial_rotate(par, ciphertext["a"], exponent),
        "b": monomial_rotate(par, ciphertext["b"], exponent),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


# ---------------------------------------------------------------------------
# Supplied: LWE, extraction, key switching
# ---------------------------------------------------------------------------


def lwe_phase(par: dict, secret, sample: dict) -> int:
    inner = sum(m * s for m, s in zip(sample["mask"], secret))
    return (sample["body"] - inner) % par["modulus"]


def lwe_decrypt(par: dict, secret, sample: dict) -> int:
    return decode(par, lwe_phase(par, secret, sample))


def lwe_encrypt(
    seed: str,
    par: dict,
    secret,
    message: int,
    label: str,
    error: int | None = None,
) -> dict:
    """A fresh LWE encryption.

    `error` forces an exact error rather than drawing one, which is what the refresh
    demonstration needs: an input carrying a chosen amount of noise, bootstrapped, and the
    output measured against a bound that does not mention it.
    """
    s = _stream(seed, f"lwe:{label}")
    mask = tuple(_pick(s, 2 * i, 0, par["modulus"] - 1) for i in range(par["dimension"]))
    drawn = _pick(s, 300, -NOISE_RANGE, NOISE_RANGE) if error is None else error
    body = (
        sum(a * x for a, x in zip(mask, secret)) + encode(par, message) + drawn
    ) % par["modulus"]
    return {"mask": mask, "body": body, "keyId": key_id(seed, "lwe"), "kind": "lwe"}


def extract_sample(par: dict, ciphertext: dict, index: int) -> dict:
    """Coefficient `index` of the phase, as an LWE sample over the ring secret."""
    degree, q = par["degree"], par["modulus"]
    a = _pad(par, ciphertext["a"])
    mask = tuple(
        (a[index - j] if j <= index else -a[index - j + degree]) % q for j in range(degree)
    )
    return {"mask": mask, "body": _pad(par, ciphertext["b"])[index] % q}


def key_id(seed: str, label: str) -> str:
    return hashlib.sha256(f"key:{seed}:{label}".encode()).hexdigest()[:10]


def switching_key(seed: str, par: dict, source, target, source_id: str, target_id: str, label: str) -> dict:
    """`ksk[j][l] = LWE_target(B^l * source[j])`, from the ring key down to the LWE key."""
    gadget, q = gadget_vector(par), par["modulus"]
    entries = []
    for j, bit in enumerate(source):
        row = []
        for level in range(par["levels"]):
            s = _stream(seed, f"ksk:{label}:{j}:{level}")
            mask = tuple(_pick(s, 2 * i, 0, q - 1) for i in range(par["dimension"]))
            noise = _pick(s, 300, -NOISE_RANGE, NOISE_RANGE)
            body = (
                sum(m * t for m, t in zip(mask, target)) + gadget[level] * bit + noise
            ) % q
            row.append({"mask": mask, "body": body})
        entries.append(tuple(row))
    return {
        "entries": tuple(entries),
        "sourceKeyId": source_id,
        "targetKeyId": target_id,
        "sourceDimension": len(source),
        "targetDimension": par["dimension"],
        "base": par["base"],
        "levels": par["levels"],
        "modulus": q,
    }


def key_switch(par: dict, key: dict, sample: dict) -> dict:
    q = par["modulus"]
    accumulator = [0] * key["targetDimension"]
    body = sample["body"] % q
    for j, value in enumerate(sample["mask"]):
        for level, digit in enumerate(decompose(par, value)):
            if not digit:
                continue
            entry = key["entries"][j][level]
            for i in range(key["targetDimension"]):
                accumulator[i] -= digit * entry["mask"][i]
            body -= digit * entry["body"]
    return {"mask": tuple(v % q for v in accumulator), "body": body % q}


def bootstrap_key(seed: str, par: dict, ring_key, lwe_bits, label: str = "public") -> tuple:
    return tuple(
        rgsw_encrypt(par, ring_key, bit, rgsw_material(seed, par, f"{label}:bk{i}"))
        for i, bit in enumerate(lwe_bits)
    )


# ---------------------------------------------------------------------------
# Supplied: the four unary functions, and artifact fingerprints
# ---------------------------------------------------------------------------

#: The four unary boolean functions, named so a test can pick one.
UNARY = {
    "identity": lambda m: m,
    "negate": lambda m: 1 - m,
    "always-zero": lambda _m: 0,
    "always-one": lambda _m: 1,
}


def digest(values) -> str:
    """A short fingerprint of an artifact's numbers, so a trace row names a real one."""
    return hashlib.sha256(":".join(str(v) for v in values).encode()).hexdigest()[:12]


def lwe_digest(sample: dict) -> str:
    """Mask then body, in order. Supplied so a trace row's digest is not a guessing game."""
    return digest((*sample["mask"], sample["body"]))


def rlwe_digest(par: dict, ciphertext: dict) -> str:
    """`a` then `b`, both padded to the degree. Same reason."""
    return digest((*_pad(par, ciphertext["a"]), *_pad(par, ciphertext["b"])))


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(f"health:{seed}:{par['parameterSetId']}".encode()).hexdigest()[:16]
