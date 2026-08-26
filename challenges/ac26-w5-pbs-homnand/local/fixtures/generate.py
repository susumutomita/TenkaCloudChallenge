"""This problem's ground truth: the pipeline, the gate, and the noise contract.

The supplied Week 5 stack this builds on lives in `participant/fhe.py` and is imported
below rather than restated, so the arithmetic a learner builds on and the one they are
graded against cannot drift apart.

Issue 543/537: this file used to hold both halves and shipped in the single participant
Docker stage. It cannot derive a deployment's parameters and traces without implementing
`lookup_accumulator`, `to_rotation_domain`, `blind_rotate`, `output_noise_bound`,
`correctness_bound`, `refresh_report` and `nand_combine` -- seven of the twelve names
`starter/pipeline.py` asks the learner to write -- so while it shipped there, every one of
them was a single import away, with no comparison anywhere near them. Option B2 keeps this
file in the verifier image only; `show.py` reads this deployment's public half from the
verifier's `GET /public` (see `public_payload` at the bottom, `show.py`, and the
VERIFIER_PUBLIC_URL wiring in docker-compose.yml).

## The encoding, and why it changed

    encode(1) =  q/8        encode(0) = -q/8        decode(c) = 1 if centered(c) > 0
    plaintext_modulus = 2

Balanced, not `m * delta`. Under it, decoding **is** a sign test -- and a sign test is what
negacyclic rotation computes for free, because `X^N = -1` negates whatever wraps past the
degree. The previous problems' encoding cannot express that, which is the concrete answer to
"why can't PBS just evaluate any function".

Tolerance is `q/8`: a phase decodes correctly while it stays on its own side of 0 and q/2.

## The pipeline

    LWE(dimension n, key s_lwe)
      -> rotation domain          scale by 2N/q and round; error at most (n+1)/2
      -> LUT accumulator          a trivial RLWE ciphertext, no mask and no noise
      -> blind rotation           X^(-phase) * accumulator, phase never computed
      -> RLWE(ring key)
      -> sample extraction        coefficient 0, at dimension N under the ring key
      -> key switching            back to dimension n under s_lwe
      -> LWE(dimension n, key s_lwe)

The output key is the input key, so the result can be fed back in. That is what makes this
bootstrapping rather than a one-way evaluation, and `check_evaluate` runs a second pass over
a first pass to prove it.

## The lookup table

Blind rotation puts `TV[phase_rot]` in coefficient 0, negated when `phase_rot >= N`. A bit
encoded as `+-q/8` lands at `phase_rot = N/4` for 1 and `7N/4` for 0, so:

    TV[k] = encode(f(1))       for k in [0, N/2)      reached by m = 1
    TV[k] = encode(1 - f(0))   for k in [N/2, N)      reached by m = 0, through the negation

The `1 - f(0)` is the negation being undone: coefficient 0 receives `-TV[3N/4]`, and the
encoding is balanced, so `-encode(x)` is `encode(1 - x)`. All four unary boolean functions
come out of that, and which one is a property of the accumulator alone -- the rest of the
pipeline does not know which function it is evaluating.

## HomNAND

Bits are combined before the bootstrap, not after:

    combined = (0, q/8) - c1 - c2        phase = q/8 - phase1 - phase2

which is `3q/8, q/8, q/8, -q/8` for the four input pairs -- positive except for `(1, 1)`.
One PBS with the identity table turns that sign into a fresh encrypted bit. NAND is a linear
combination and a single bootstrap; there is no plaintext NAND anywhere.

## Noise

Blind rotation contributes `n * 2L * N * (B-1)` and the key switch `N * L * (B-1)`; the
accumulator starts as a trivial ciphertext carrying none, and extraction adds none. The
input's noise does not appear in that sum **at all** -- which is the refresh, and the reason
the output can be bootstrapped again. `VIABLE` is enumerated rather than sampled so both the
output bound and the domain-switch tolerance always fit, and
`scripts/ac26-w5-pbs-homnand.test.ts` checks the arithmetic rather than trusting this
paragraph.

None of this is secure. The parameters are small enough to enumerate and both secrets fall
to linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations

# The supplied half, re-exported. `tests/hidden/`, `reference/` and `mutation.py` import
# every one of these from `fixtures.generate`, and did so before the split; keeping the
# names reachable here is what makes the split invisible to them.
from participant.fhe import (  # noqa: F401 - re-exported for the hidden suite and mutation
    NOISE_RANGE,
    UNARY,
    VIABLE,
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
    extract_sample,
    gadget_vector,
    health_token,
    key_id,
    key_switch,
    key_switch_noise,
    lwe_decrypt,
    lwe_digest,
    lwe_encrypt,
    lwe_phase,
    lwe_secret,
    monomial_rotate,
    normalize,
    parameter_set_id,
    params,
    rgsw_encrypt,
    rgsw_material,
    ring_add,
    ring_mul,
    ring_noise,
    ring_random,
    ring_secret,
    ring_sub,
    rlwe_digest,
    rlwe_phase,
    rotate_ciphertext,
    switching_key,
)


# ---------------------------------------------------------------------------
# Ground truth: the noise contract
# ---------------------------------------------------------------------------


def output_noise_bound(par: dict) -> int:
    """What a bootstrapped ciphertext carries. Independent of what went in -- that is the point."""
    return blind_rotation_noise(par) + key_switch_noise(par)


def correctness_bound(par: dict) -> int:
    """The most input noise a bootstrap tolerates, in `Z_q`.

    A phase decodes correctly while it stays on its own side of 0 and q/2, which is `N/4`
    rotation-domain units away. The domain switch spends up to `(n+1)/2` of those on
    rounding -- one half-unit per mask coefficient and one for the body -- and what is left
    converts back at `q / 2N` per unit.
    """
    spare = par["degree"] // 4 - (par["dimension"] + 1) / 2
    return int(spare * par["modulus"] / (2 * par["degree"]))


# ---------------------------------------------------------------------------
# Ground truth: the pipeline
# ---------------------------------------------------------------------------


def lookup_accumulator(par: dict, table: dict) -> dict:
    """The trivial RLWE ciphertext whose coefficients encode `f`.

    `table` is `{0: f(0), 1: f(1)}`. The upper half carries `1 - f(0)` rather than `f(0)`
    because coefficient 0 receives it **negated**, and the balanced encoding turns that
    negation into a flipped bit.
    """
    degree = par["degree"]
    coefficients = [
        encode(par, table[1]) if k < degree // 2 else encode(par, 1 - table[0])
        for k in range(degree)
    ]
    return {"a": tuple([0] * degree), "b": normalize(par, coefficients)}


def to_rotation_domain(par: dict, sample: dict) -> dict:
    """Scale `Z_q` to `Z_2N` and round. Every rounding costs up to half a unit."""
    modulus, q = 2 * par["degree"], par["modulus"]

    def scaled(value: int) -> int:
        return ((value % q) * modulus + q // 2) // q % modulus

    return {
        "mask": tuple(scaled(a) for a in sample["mask"]),
        "body": scaled(sample["body"]),
        "modulus": modulus,
    }


def blind_rotate(par: dict, key, rotated: dict, accumulator: dict) -> dict:
    current = rotate_ciphertext(par, accumulator, -rotated["body"])
    for index, mask in enumerate(rotated["mask"]):
        current = cmux(par, key[index], current, rotate_ciphertext(par, current, mask))
    return current


def bootstrap(par: dict, key, switch: dict, sample: dict, table: dict) -> dict:
    """The whole pipeline, as ground truth."""
    accumulator = lookup_accumulator(par, table)
    rotated = blind_rotate(par, key, to_rotation_domain(par, sample), accumulator)
    extracted = extract_sample(par, rotated, 0)
    switched = key_switch(par, switch, extracted)
    return {**switched, "keyId": switch["targetKeyId"], "kind": "lwe"}


def nand_combine(par: dict, left: dict, right: dict) -> dict:
    """`(0, q/8) - left - right`. Positive for every input pair except (1, 1)."""
    q = par["modulus"]
    return {
        "mask": tuple((-x - y) % q for x, y in zip(left["mask"], right["mask"])),
        "body": (par["delta"] - left["body"] - right["body"]) % q,
        "keyId": left.get("keyId"),
        "kind": "lwe",
    }


def homomorphic_nand(par: dict, key, switch: dict, left: dict, right: dict) -> dict:
    return bootstrap(par, key, switch, nand_combine(par, left, right), {0: 0, 1: 1})

def pipeline_trace(par: dict, key, switch: dict, sample: dict, table: dict) -> tuple[dict, ...]:
    """One record per stage: what it produced, whose key it belongs to, and its noise bound.

    Six rows, in pipeline order. Each names the artifact it produced by digest, so the trace
    describes a run rather than a diagram.

    `noiseBound` is a bound rather than a measurement -- measuring takes a phase and a phase
    takes a key, and no stage after the input is given one. Read down the column and note
    where it stops depending on what came in: at `blind-rotation`. That is the refresh, and
    it is the whole reason the output can be bootstrapped again.
    """
    accumulator = lookup_accumulator(par, table)
    rotated_sample = to_rotation_domain(par, sample)
    rotated = blind_rotate(par, key, rotated_sample, accumulator)
    extracted = extract_sample(par, rotated, 0)
    switched = key_switch(par, switch, extracted)

    source, target = switch["sourceKeyId"], switch["targetKeyId"]
    return (
        _row(par, "input", "lwe", target, par["dimension"], par["modulus"],
             correctness_bound(par), MESSAGE_SEMANTICS["input"], lwe_digest(sample)),
        _row(par, "rotation-domain", "lwe", target, par["dimension"], rotated_sample["modulus"],
             (par["dimension"] + 1) // 2, MESSAGE_SEMANTICS["rotation-domain"],
             lwe_digest(rotated_sample)),
        _row(par, "accumulator", "rlwe", source, par["degree"], par["modulus"],
             0, MESSAGE_SEMANTICS["accumulator"], rlwe_digest(par, accumulator)),
        _row(par, "blind-rotation", "rlwe", source, par["degree"], par["modulus"],
             blind_rotation_noise(par), MESSAGE_SEMANTICS["blind-rotation"],
             rlwe_digest(par, rotated)),
        _row(par, "extraction", "lwe", source, par["degree"], par["modulus"],
             blind_rotation_noise(par), MESSAGE_SEMANTICS["extraction"], lwe_digest(extracted)),
        _row(par, "key-switch", "lwe", target, par["dimension"], par["modulus"],
             output_noise_bound(par), MESSAGE_SEMANTICS["key-switch"], lwe_digest(switched)),
    )


#: What each artifact *means*, which is not the same question as what shape it has. Three
#: assertions rather than a sentence, so they can be checked: whether the artifact carries
#: the message at all, which message, and where in the artifact it sits.
#:
#: The accumulator is the one row carrying no message -- it carries the *function* -- and
#: after the rotation `f(m)` sits at a single coefficient rather than throughout the
#: polynomial. Both are read off this column instead of inferred from the final answer
#: happening to be right.
MESSAGE_SEMANTICS = {
    "input": {"carriesMessage": True, "messageIs": "m", "located": "whole"},
    "rotation-domain": {"carriesMessage": True, "messageIs": "m", "located": "whole"},
    "accumulator": {"carriesMessage": False, "messageIs": None, "located": None},
    "blind-rotation": {"carriesMessage": True, "messageIs": "f(m)", "located": "coefficient-0"},
    "extraction": {"carriesMessage": True, "messageIs": "f(m)", "located": "whole"},
    "key-switch": {"carriesMessage": True, "messageIs": "f(m)", "located": "whole"},
}

#: Every stage runs on ciphertexts and public keys alone. Neither secret is passed to any
#: stage, which is why no row can name one.
PUBLIC_INPUTS = ("ciphertexts", "bootstrapping key", "switching key", "parameters")
WITHHELD = ("lwe secret", "ring secret")


def _row(
    par: dict, stage: str, kind: str, key: str, dimension: int, modulus: int,
    bound: int, semantic: dict, fingerprint: str,
) -> dict:
    return {
        "stage": stage,
        "kind": kind,
        "keyId": key,
        "dimension": dimension,
        "modulus": modulus,
        "parameterSetId": par["parameterSetId"],
        "noiseBound": bound,
        **semantic,
        "digest": fingerprint,
    }


#: The fields a trace row is graded on, in the order they read.
ROW_FIELDS = (
    "stage", "kind", "keyId", "dimension", "modulus", "parameterSetId",
    "noiseBound", "carriesMessage", "messageIs", "located", "digest",
)

def refresh_report(par: dict, input_noise: int) -> dict:
    """What the correctness contract says about one input, and what comes out regardless.

    `outputNoiseBound` does not mention `input_noise` and does not vary with it. That is the
    refresh stated as an equation rather than as a paragraph: read it twice with different
    inputs and the number is the same, which is exactly why a bootstrapped ciphertext can be
    bootstrapped again. `secondPassFits` says whether it actually can, at these parameters.
    """
    return {
        "inputNoise": input_noise,
        "correctnessBound": correctness_bound(par),
        "outputNoiseBound": output_noise_bound(par),
        "withinContract": abs(input_noise) <= correctness_bound(par),
        "secondPassFits": 2 * output_noise_bound(par) <= correctness_bound(par),
    }


# ---------------------------------------------------------------------------
# The public half of a deployment
# ---------------------------------------------------------------------------


def public_payload(seed: str, function_name: str = "identity", message: int = 1) -> dict:
    """Everything the participant image is allowed to see, and nothing else.

    This is the single place that decides what "public" means for this problem, and it is
    exactly one thing: **the demonstration `show.py` has always printed**. Every number
    below appeared on a participant's screen before Issue 543 and appears there after it.
    The split moved where these are computed, not who may read them.

    What that deliberately excludes is the *implementations*. `output_noise_bound`,
    `correctness_bound` and `refresh_report` are returned here as the three numbers and the
    five fields `show.py` prints, not as the functions that produce them; the trace comes
    back as its printed columns, not as `pipeline_trace`; the gate comes back as four
    decoded bits and their phases, not as `nand_combine` and `homomorphic_nand`. Those seven
    names are what `starter/pipeline.py` asks the learner to write, and reading a number off
    one deployment is not the same as being handed the function that produced it -- every
    checkpoint is graded by running `tests/hidden/check_pipeline.py` against the learner's
    own file, and `transfer` runs under a derived seed whose parameters appear nowhere here.

    Ciphertexts are not returned at all. `show.py` printed decoded bits, centered phases and
    digests, so that is what this returns -- strictly less than the artifacts themselves.
    """
    par = params(seed)
    if function_name not in UNARY:
        function_name = "identity"
    function = UNARY[function_name]
    message = 1 if message else 0
    table = {0: function(0), 1: function(1)}

    ring_key = ring_secret(seed, par, "ring")
    lwe_key = lwe_secret(seed, par, "lwe")
    source_id, target_id = key_id(seed, "ring"), key_id(seed, "lwe")
    key = bootstrap_key(seed, par, ring_key, lwe_key, "show")
    switch = switching_key(seed, par, ring_key, lwe_key, source_id, target_id, "show")

    sample = lwe_encrypt(seed, par, lwe_key, message, "show")
    sample = {**sample, "keyId": target_id, "dimension": par["dimension"]}

    rows = pipeline_trace(par, key, switch, sample, table)
    result = bootstrap(par, key, switch, sample, table)
    report = refresh_report(par, correctness_bound(par) // 2)

    gate_rows = []
    for left_bit in (0, 1):
        for right_bit in (0, 1):
            left = lwe_encrypt(seed, par, lwe_key, left_bit, f"show:{left_bit}{right_bit}:l")
            right = lwe_encrypt(seed, par, lwe_key, right_bit, f"show:{left_bit}{right_bit}:r")
            left = {**left, "keyId": target_id}
            right = {**right, "keyId": target_id}
            gate = homomorphic_nand(par, key, switch, left, right)
            combined = centered(
                par,
                (par["delta"] - lwe_phase(par, lwe_key, left) - lwe_phase(par, lwe_key, right))
                % par["modulus"],
            )
            gate_rows.append(
                {
                    "left": left_bit,
                    "right": right_bit,
                    "value": lwe_decrypt(par, lwe_key, gate),
                    "combinedPhase": combined,
                }
            )

    input_phase = lwe_phase(par, lwe_key, sample)
    return {
        "healthToken": health_token(seed),
        "params": dict(par),
        "functions": sorted(UNARY),
        "function": function_name,
        "message": message,
        "applied": function(message),
        "table": {"0": table[0], "1": table[1]},
        "noise": {
            "blindRotation": blind_rotation_noise(par),
            "keySwitch": key_switch_noise(par),
            "output": output_noise_bound(par),
            "correctness": correctness_bound(par),
        },
        "rows": [dict(row) for row in rows],
        "publicInputs": list(PUBLIC_INPUTS),
        "withheld": list(WITHHELD),
        "before": {
            "phase": centered(par, input_phase),
            "decodes": decode(par, input_phase),
        },
        "after": {
            "phase": centered(par, lwe_phase(par, lwe_key, result)),
            "decodes": lwe_decrypt(par, lwe_key, result),
            "keyId": result["keyId"],
            "lastDigest": rows[-1]["digest"],
        },
        "refreshReport": dict(report),
        "gate": gate_rows,
    }
