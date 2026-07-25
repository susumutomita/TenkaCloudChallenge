"""Parameters, the supplied TFHE layer up to blind rotation, and this problem's ground truth.

Nothing here is copied from the course's toy TFHE exercise: no function names, no fixtures,
no skeleton. Parameters come from the seed and every convention is written out below, so a
learner who has read the official material gains no shortcut.

Everything through blind rotation is **supplied**. The ring, RLWE, the gadget, RGSW, the
external product, CMUX and the rotation loop are `ac26-w5-lwe-rlwe`, `-rgsw-external` and
`-cmux-blind-rotation`'s output. This problem is the two steps that come after: getting one
coefficient out of the accumulator as an LWE sample, and moving that sample to a different
key and dimension without changing what it says.

## Sample extraction

Blind rotation leaves an RLWE ciphertext `(a, b)` whose phase polynomial is `b - a*s`. Only
one coefficient of it is wanted. Extracting coefficient `k` means writing that coefficient
as an LWE phase over the ring secret's own coefficients:

    phase_k = b_k - sum_j c_j * s_j

    c_j =  a_(k-j)        for j <= k        no wrap, positive
    c_j = -a_(k-j+N)      for j >  k        wrapped past the degree, negated

The negation is the same `X^N = -1` from the rotation problem, seen from the other side: a
product term whose indices sum past the degree comes back with its sign flipped, so the mask
coefficient that collects it has to carry that flip. Nothing is decrypted and no noise is
added -- the extracted sample's phase **is** the polynomial's coefficient, exactly.

The resulting LWE secret is `(s_0, ..., s_(N-1))`, the ring secret read as a vector. That is
what makes the next step necessary: it is not the key the rest of the system uses.

## Key switching

Move an LWE sample from `s_old` (dimension `n_old`) to `s_new` (dimension `n_new`), with the
same message. The switching key holds, for every old index `j` and every level `l`, an LWE
encryption **under the new key** of the scalar `B^l * s_old[j]`:

    ksk[j][l] = LWE_(s_new)( B^l * s_old[j] )

Decompose each old mask coefficient into base-B digits and subtract the matching entries:

    c_j = sum_l d_(j,l) * B^l
    result = (0, body) - sum_(j,l) d_(j,l) * ksk[j][l]

The result's phase is `body - sum_(j,l) d_(j,l) * B^l * s_old[j] - noise`, and that sum is
exactly `<c, s_old>`. So the phase is the original one, less the noise the entries carried.
Nothing was decrypted: `s_old` appears only inside ciphertexts, and `s_new` never appears at
all. Key switching is not a decrypt-and-re-encrypt, and the absence of any decryption in
that derivation is the whole reason it is usable.

The decomposition convention is `ac26-w5-rgsw-external`'s, unchanged: `q = base ** levels`,
unsigned, LSB-first, exactly `levels` digits, gadget `(1, B, B^2, ...)`.

## Noise

Extraction adds none. Key switching adds `sum_(j,l) d_(j,l) * e_(j,l)`, bounded by
`n_old * levels * (base - 1) * NOISE_RANGE`. The accumulator arriving from a blind rotation
already carries `dimension` external products' worth. `VIABLE` is enumerated rather than
sampled so the total always fits, and
`scripts/ac26-w5-extract-key-switch.test.ts` checks the arithmetic rather than trusting this
paragraph.

None of this is secure. The parameters are small enough to enumerate and both secrets fall
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

import hashlib

#: (base, levels, degree, dimension, target_dimension) whose end-to-end noise fits the budget.
#: Enumerated rather than sampled: most combinations do not fit, and a parameter set that
#: silently exceeded the budget would make a correct submission fail.
#:
#: `degree` is the ring degree, so it is also the dimension of the *extracted* sample --
#: which is why `target_dimension` differs from it in every entry. A key switch that landed
#: on the same dimension it started from would let a submission that ignored the target
#: entirely still produce a plausibly-shaped answer.
VIABLE = (
    (2, 13, 4, 3, 2),
    (2, 13, 4, 3, 6),
    (2, 13, 4, 4, 3),
    (2, 14, 4, 3, 5),
    (2, 14, 8, 3, 5),
    (4, 7, 4, 3, 2),
    (4, 7, 4, 3, 6),
    (4, 7, 4, 4, 5),
    (4, 8, 8, 3, 4),
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
    base, levels, degree, dimension, target = VIABLE[_pick(s, 0, 0, len(VIABLE) - 1)]
    modulus = base**levels
    plaintext_modulus = 4
    return {
        "base": base,
        "levels": levels,
        "degree": degree,
        "dimension": dimension,
        "target_dimension": target,
        "modulus": modulus,
        "plaintext_modulus": plaintext_modulus,
        "delta": modulus // plaintext_modulus,
    }


def blind_rotation_noise(par: dict) -> int:
    """What the accumulator carries when it arrives from a blind rotation."""
    return par["dimension"] * 2 * par["levels"] * par["degree"] * (par["base"] - 1) * NOISE_RANGE


def key_switch_noise(par: dict) -> int:
    """What the switch adds: one digit times one entry's noise, over every index and level."""
    return par["degree"] * par["levels"] * (par["base"] - 1) * NOISE_RANGE


def noise_bound(par: dict) -> int:
    """The whole pipeline: blind rotation, extraction (free), then the switch."""
    return blind_rotation_noise(par) + key_switch_noise(par)


# ---------------------------------------------------------------------------
# Supplied: the ring, the encoding, the gadget
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


def decompose_poly(par: dict, poly) -> tuple[tuple[int, ...], ...]:
    per_coefficient = [decompose(par, c) for c in _pad(par, poly)]
    return tuple(
        tuple(per_coefficient[k][i] for k in range(par["degree"]))
        for i in range(par["levels"])
    )


# ---------------------------------------------------------------------------
# Supplied: RLWE, RGSW, the external product, CMUX and blind rotation
# ---------------------------------------------------------------------------


def rlwe_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
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
    return {
        "a": tuple([0] * par["degree"]),
        "b": normalize(par, [encode(par, m) for m in _pad(par, messages)]),
    }


def rlwe_phase(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return ring_sub(par, ciphertext["b"], ring_mul(par, ciphertext["a"], secret))


def rlwe_decrypt(par: dict, secret, ciphertext: dict) -> tuple[int, ...]:
    return tuple(decode(par, value) for value in rlwe_phase(par, secret, ciphertext))


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
    shift = exponent % (2 * par["degree"])
    return normalize(par, [0] * shift + _pad(par, poly))


def rotate_ciphertext(par: dict, ciphertext: dict, exponent: int) -> dict:
    return {
        "a": monomial_rotate(par, ciphertext["a"], exponent),
        "b": monomial_rotate(par, ciphertext["b"], exponent),
    }


def lwe_secret_bits(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    s = _stream(seed, f"lwe-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["dimension"] - 1)] = 1
    return tuple(bits)


def lwe_sample(seed: str, par: dict, secret, label: str = "public") -> dict:
    modulus = 2 * par["degree"]
    s = _stream(seed, f"lwe-sample:{label}")
    mask = tuple(_pick(s, 2 * i, 0, modulus - 1) for i in range(par["dimension"]))
    phase = _pick(s, 200, 0, modulus - 1)
    body = (sum(m * k for m, k in zip(mask, secret)) + phase) % modulus
    return {"mask": mask, "body": body, "modulus": modulus}


def bootstrap_key(seed: str, par: dict, ring_key, bits, label: str = "public") -> tuple:
    return tuple(
        rgsw_encrypt(par, ring_key, bit, rgsw_material(seed, par, f"{label}:bk{i}"))
        for i, bit in enumerate(bits)
    )


def blind_rotate(par: dict, key, sample: dict, accumulator: dict) -> dict:
    current = rotate_ciphertext(par, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = cmux(par, key[index], current, rotate_ciphertext(par, current, mask))
    return current


def test_vector(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """Coefficients from `{1, 3}` -- the residues negation moves, so a wrap stays visible."""
    s = _stream(seed, f"testvector:{label}")
    return tuple(1 + 2 * _pick(s, 2 * i, 0, 1) for i in range(par["degree"]))


def rotated_accumulator(seed: str, par: dict, ring_key, label: str = "public") -> dict:
    """A real blind-rotation output, which is what extraction is for.

    Everything the accumulator carries -- the noise from `dimension` external products
    included -- is what the switch downstream has to stay inside.
    """
    bits = lwe_secret_bits(seed, par, label)
    key = bootstrap_key(seed, par, ring_key, bits, label)
    sample = lwe_sample(seed, par, bits, label)
    return blind_rotate(par, key, sample, rlwe_trivial(par, test_vector(seed, par, label)))


# ---------------------------------------------------------------------------
# Ground truth: extraction
# ---------------------------------------------------------------------------


def phase_coefficient(par: dict, ring_key, ciphertext: dict, index: int) -> int:
    """Coefficient `index` of `b - a*s`, computed in the ring. The number extraction preserves."""
    if not 0 <= index < par["degree"]:
        raise ValueError("coefficient index outside the ring")
    return rlwe_phase(par, ring_key, ciphertext)[index]


def extract_sample(par: dict, ciphertext: dict, index: int) -> dict:
    """Coefficient `index` of the phase, rewritten as an LWE sample over the ring secret."""
    if not 0 <= index < par["degree"]:
        raise ValueError("coefficient index outside the ring")
    degree, q = par["degree"], par["modulus"]
    a = _pad(par, ciphertext["a"])
    mask = tuple(
        (a[index - j] if j <= index else -a[index - j + degree]) % q for j in range(degree)
    )
    return {"mask": mask, "body": _pad(par, ciphertext["b"])[index] % q}


def extract_trace(par: dict, ciphertext: dict, index: int) -> tuple[dict, ...]:
    """One record per extracted mask slot: where it came from and whether it wrapped."""
    degree, q = par["degree"], par["modulus"]
    a = _pad(par, ciphertext["a"])
    records = []
    for j in range(degree):
        wrapped = j > index
        source = index - j + degree if wrapped else index - j
        records.append(
            {
                "target": j,
                "source": source,
                "sign": -1 if wrapped else 1,
                "wrapped": wrapped,
                "value": (-a[source] if wrapped else a[source]) % q,
            }
        )
    return tuple(records)


def lwe_phase_of(par: dict, secret, sample: dict) -> int:
    """`body - <mask, secret>` in `Z_q`. The same shape at either dimension."""
    inner = sum(m * s for m, s in zip(sample["mask"], secret))
    return (sample["body"] - inner) % par["modulus"]


def lwe_decrypt(par: dict, secret, sample: dict) -> int:
    return decode(par, lwe_phase_of(par, secret, sample))


# ---------------------------------------------------------------------------
# Ground truth: key switching
# ---------------------------------------------------------------------------


def target_secret(seed: str, par: dict, label: str = "public") -> tuple[int, ...]:
    """The key being switched *to*. A different dimension, and never all zero."""
    s = _stream(seed, f"target-secret:{label}")
    bits = [_pick(s, 2 * i, 0, 1) for i in range(par["target_dimension"])]
    if not any(bits):
        bits[_pick(s, 90, 0, par["target_dimension"] - 1)] = 1
    return tuple(bits)


def key_id(seed: str, label: str) -> str:
    """A short, stable name for a key, so a ciphertext can say which one it belongs to."""
    return hashlib.sha256(f"key:{seed}:{label}".encode()).hexdigest()[:10]


def switching_key(
    seed: str, par: dict, source_secret, target, source_id: str, target_id: str, label: str
) -> dict:
    """`ksk[j][l] = LWE_target(B^l * source_secret[j])`, plus the metadata that names its domains.

    The scalar goes in raw, not through `encode`: the switch subtracts these from a phase and
    the arithmetic has to land exactly, not to within a rounding step.
    """
    gadget, q = gadget_vector(par), par["modulus"]
    entries = []
    for j, bit in enumerate(source_secret):
        row = []
        for level in range(par["levels"]):
            s = _stream(seed, f"ksk:{label}:{j}:{level}")
            mask = tuple(
                _pick(s, 2 * i, 0, q - 1) for i in range(par["target_dimension"])
            )
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
        "sourceDimension": len(source_secret),
        "targetDimension": par["target_dimension"],
        "base": par["base"],
        "levels": par["levels"],
        "modulus": q,
    }


def decompose_mask(par: dict, mask) -> tuple[tuple[int, ...], ...]:
    """One digit tuple per mask coefficient, LSB-first, exactly `levels` of them."""
    return tuple(decompose(par, value) for value in mask)


def key_switch(par: dict, key: dict, sample: dict) -> dict:
    """`(0, body) - sum d[j][l] * ksk[j][l]`, which lands under the target key.

    Nothing is decrypted here. `source_secret` only ever appears inside the switching key's
    ciphertexts, and the target secret does not appear at all.
    """
    if key["sourceDimension"] != len(sample["mask"]):
        raise ValueError("the switching key does not match the sample's dimension")
    if key["modulus"] != par["modulus"] or key["base"] != par["base"] or key["levels"] != par["levels"]:
        raise ValueError("the switching key was built for different parameters")
    if sample.get("keyId") is not None and sample["keyId"] != key["sourceKeyId"]:
        raise ValueError("the switching key is for a different source key")

    q = par["modulus"]
    accumulator = [0] * key["targetDimension"]
    body = sample["body"] % q
    digits = decompose_mask(par, sample["mask"])
    for j, per_level in enumerate(digits):
        for level, digit in enumerate(per_level):
            if not digit:
                continue
            entry = key["entries"][j][level]
            for i in range(key["targetDimension"]):
                accumulator[i] -= digit * entry["mask"][i]
            body -= digit * entry["body"]
    return {
        "mask": tuple(value % q for value in accumulator),
        "body": body % q,
        "keyId": key["targetKeyId"],
    }


def domain_report(par: dict, sample: dict, key: dict) -> dict:
    """What the artifacts say about which key and dimension each side lives in.

    Compatibility is decided from the declared metadata, not by trying to decrypt anything --
    that is the only way to decide it, since neither secret is here.
    """
    compatible = (
        key["sourceDimension"] == len(sample["mask"])
        and key["modulus"] == par["modulus"]
        and key["base"] == par["base"]
        and key["levels"] == par["levels"]
        and (sample.get("keyId") is None or sample["keyId"] == key["sourceKeyId"])
    )
    return {
        "sourceKeyId": key["sourceKeyId"],
        "targetKeyId": key["targetKeyId"],
        "sourceDimension": len(sample["mask"]),
        "targetDimension": key["targetDimension"],
        "modulus": par["modulus"],
        "base": par["base"],
        "levels": par["levels"],
        "compatible": compatible,
        "noiseAdded": len(sample["mask"]) * par["levels"] * (par["base"] - 1),
    }


def digest(par: dict, sample: dict) -> str:
    payload = ":".join(str(value) for value in (*sample["mask"], sample["body"]))
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def health_token(seed: str) -> str:
    par = params(seed)
    return hashlib.sha256(
        f"health:{seed}:{par['base']}:{par['levels']}:{par['degree']}:{par['target_dimension']}".encode()
    ).hexdigest()[:16]
