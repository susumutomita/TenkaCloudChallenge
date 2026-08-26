"""This problem's ground truth: extraction, key switching, and the public half of a deployment.

Issue 543/537: this file does **not** ship in the participant Docker stage any more (see
../Dockerfile). It implements `phase_coefficient`, `extract_sample`, `extract_trace`,
`decompose_mask`, `key_switch` and `domain_report` -- every one of the six names
`starter/extract.py` asks the learner to write -- because it cannot derive this deployment's
trace, its switched sample or its domain report without them. While it shipped alongside
the starter, all six were a single import away, with no comparison anywhere near them.

The supplied half moved to `participant/fhe.py` and is re-exported below, so the hidden
suite, the reference and `mutation.py` see the names they always did. `show.py` reads this
deployment's public half from the verifier's `GET /public` (see `public_payload` at the
bottom, `show.py`, and the VERIFIER_PUBLIC_URL wiring in ../docker-compose.yml).

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

None of this is secure. The parameters are small enough to enumerate and both secrets fall
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

# The supplied half, re-exported. `tests/hidden/`, `reference/` and `mutation.py` import
# every one of these from `fixtures.generate`, and did so before the split; keeping the
# names reachable here is what makes the split invisible to them. `_pad` comes with them
# because the two extraction functions below read a padded coefficient list.
from participant.fhe import (  # noqa: F401 - re-exported for the hidden suite and mutation
    NOISE_RANGE,
    VIABLE,
    _pad,
    blind_rotate,
    blind_rotation_noise,
    bootstrap_key,
    centered,
    cmux,
    decode,
    decompose,
    decompose_poly,
    digest,
    encode,
    external_product,
    gadget_vector,
    health_token,
    key_id,
    key_switch_noise,
    lwe_decrypt,
    lwe_phase_of,
    lwe_sample,
    lwe_secret_bits,
    monomial_rotate,
    noise_bound,
    normalize,
    params,
    rgsw_encrypt,
    rgsw_material,
    ring_add,
    ring_mul,
    ring_noise,
    ring_random,
    ring_sub,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_phase,
    rlwe_secret,
    rlwe_trivial,
    rotate_ciphertext,
    rotated_accumulator,
    switching_key,
    target_secret,
    test_vector,
)

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


# ---------------------------------------------------------------------------
# Ground truth: key switching
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# The public half of a deployment
# ---------------------------------------------------------------------------


def public_payload(seed: str, index: int = 0) -> dict:
    """Everything the participant image is allowed to see, and nothing else.

    This is the single place that decides what "public" means for this problem, and it is
    exactly one thing: **the demonstration `show.py` has always printed**. Every number
    below appeared on a participant's screen before Issue 543 and appears there after it.
    The split moved where these are computed, not who may read them.

    What that deliberately excludes is the *implementations*. The trace comes back as the
    five printed columns for one index, not as `extract_trace`; the extracted and switched
    samples come back as the numbers `show.py` printed, not as `extract_sample` and
    `key_switch`; the report comes back as its eight fields, not as `domain_report`. Those
    six names are what `starter/extract.py` asks the learner to write, and reading one
    deployment's numbers off the screen is not the same as being handed the function that
    produced them -- every checkpoint is graded by running `tests/hidden/check_extract.py`
    against the learner's own file, over four parameter sets and every index of the ring,
    and `transfer` runs under a derived seed whose parameters appear nowhere here.

    `index` is a query knob because `make inspect INDEX=...` has always been able to ask for
    any coefficient of the ring, and the instruction to compare index 0 against the last one
    is the whole point of `show.py`'s opening paragraph. It is clamped the way `show.py`
    clamped it before the split.
    """
    par = params(seed)
    degree = par["degree"]
    index = max(0, min(int(index), degree - 1))

    ring_key = rlwe_secret(seed, par, "ring")
    target = target_secret(seed, par, "target")
    source_id, target_id = key_id(seed, "ring"), key_id(seed, "target")
    accumulator = rotated_accumulator(seed, par, ring_key, "show")

    sample = dict(extract_sample(par, accumulator, index))
    sample["keyId"] = source_id
    key = switching_key(seed, par, ring_key, target, source_id, target_id, "show")
    switched = key_switch(par, key, sample)
    report = domain_report(par, sample, key)
    coefficient = phase_coefficient(par, ring_key, accumulator, index)

    return {
        "healthToken": health_token(seed),
        "index": index,
        "params": {
            "base": par["base"],
            "levels": par["levels"],
            "degree": degree,
            "targetDimension": par["target_dimension"],
            "modulus": par["modulus"],
            "plaintextModulus": par["plaintext_modulus"],
            "delta": par["delta"],
        },
        "noise": {"bound": noise_bound(par), "budget": par["delta"] // 2},
        "accumulator": {"a": list(accumulator["a"]), "b": list(accumulator["b"])},
        "trace": [dict(record) for record in extract_trace(par, accumulator, index)],
        "extracted": {
            "mask": list(sample["mask"]),
            "body": sample["body"],
            "phase": lwe_phase_of(par, ring_key, sample),
            "coefficient": coefficient,
        },
        "digits": [list(row) for row in decompose_mask(par, sample["mask"])],
        "report": dict(report),
        "switched": {
            "mask": list(switched["mask"]),
            "body": switched["body"],
            "keyId": switched["keyId"],
        },
        "messages": {
            "coefficient": decode(par, coefficient),
            "extracted": lwe_decrypt(par, ring_key, sample),
            "switched": lwe_decrypt(par, target, switched),
        },
    }
