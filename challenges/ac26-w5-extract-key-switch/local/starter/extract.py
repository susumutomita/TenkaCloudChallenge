"""Edit this file to extract one encrypted value and move it to another key.

A ciphertext is transformed message data. A polynomial such as 1+2X is stored
as coefficients [1,2]. The ring replaces X**N with -1 and reduces numbers by q.
LWE has a mask array and a body; RLWE has two coefficient arrays a,b. A phase
subtracts the key contribution. Extraction preserves a phase exactly; switching
changes its noise but preserves the message within the decoding budget.

Start with phase_coefficient and submit phase. Public tests also need later
functions, so their unfinished failures do not block this first checkpoint.
The statement supplies every required formula and compatibility condition.
Only phase_coefficient receives a key for checking. extract_sample and
key_switch do not decrypt or receive either secret key.

params is a dict: degree=N, modulus=q, base=B, levels=L, q=B**L.
Python ** is a power, // integer division and % the division remainder.
These tiny keys can be enumerated. Unknown noise is not an exact linear equation;
this is an arithmetic teaching model, not practical security.
"""

from __future__ import annotations

from participant.fhe import decompose, rlwe_phase  # noqa: F401 - the supplied layer


# ---------------------------------------------------------------------------
# The equation extraction has to preserve
# ---------------------------------------------------------------------------


def phase_coefficient(params: dict, ring_key, ciphertext: dict, index: int) -> int:
    """Coefficient `index` of `b - a*s`, computed in the ring.

    The reference the rest of the problem is measured against, and the only function here
    that gets a secret at all. `rlwe_phase(params, secret, ciphertext)` is supplied.

    Reject an index outside the ring.
    """
    return 0


# ---------------------------------------------------------------------------
# Sample extraction
# ---------------------------------------------------------------------------


def extract_sample(params: dict, ciphertext: dict, index: int) -> dict:
    """Return `{"mask": (...), "body": ...}` — coefficient `index` as an LWE sample.

    The mask has `degree` coefficients, one per ring-secret coefficient, and the sample's
    phase has to come out equal to `phase_coefficient` for the same index — exactly, not to
    within a rounding step. Extraction adds no noise and decrypts nothing.

    For j=0..N-1: source=(index-j)%N, wrapped=(j>index), sign=-1 if
    wrapped else 1, mask[j]=(sign*a[source])%q and body=b[index]%q.

    Reject an index outside the ring. Do not special-case index 0.
    """
    return {}


def extract_trace(params: dict, ciphertext: dict, index: int) -> tuple[dict, ...]:
    """One record per extracted mask slot, so the mapping can be read rather than trusted.

    `degree` records. Each one:

    ```text
    target    the extracted mask slot, 0 .. degree-1
    source    which coefficient of `a` it came from
    sign      +1 or -1
    wrapped   whether that pairing crossed the degree
    value     the mask coefficient itself, reduced
    ```

    At index=N-1 every wrapped value is False. At other indices the later
    positions become True.
    """
    return ()


# ---------------------------------------------------------------------------
# Key switching
# ---------------------------------------------------------------------------


def decompose_mask(params: dict, mask) -> tuple[tuple[int, ...], ...]:
    """One digit tuple **per mask coefficient**, most significant first, exactly `levels` of them.

    Watch the shape against `ac26-w5-rgsw-external`. That problem wanted one ring element
    per level, because the external product multiplied a level by a ring element. Here each
    coefficient's digits index into that coefficient's own switching-key entries, so the
    grouping is the other way round.
    """
    return ()


def key_switch(params: dict, switching_key: dict, sample: dict) -> dict:
    """Return `{"mask": (...), "body": ..., "keyId": ...}` under the target key.

    ```text
    switching_key["entries"][j][l]   {"mask": (...target_dimension...), "body": ...}
                                     an LWE encryption under the target key of B^(L-1-l) * source[j]
    switching_key["sourceKeyId"]     which key the input is expected to be under
    switching_key["targetKeyId"]     which key the output lands under
    switching_key["sourceDimension"] / ["targetDimension"] / ["base"] / ["levels"] / ["modulus"]
    ```

    Start from `(0, body)` and subtract. Write down what each subtraction removes from the
    phase and the shape of the answer follows.

    Reject a key that does not match the sample — dimension, parameters, or a `keyId` on the
    sample that names a different source key. Applying it anyway does not establish that the ciphertext is valid under
    the intended target key; it may produce an incorrect result.

    The result carries the target key's id. It must not carry a secret.
    """
    return {}


def domain_report(params: dict, sample: dict, switching_key: dict) -> dict:
    """Classify which key and dimension each side of the switch lives in.

    ```text
    sourceKeyId       targetKeyId
    sourceDimension   targetDimension
    modulus           base            levels
    compatible        whether this key can switch this sample
    noiseAdded        the switch's noise bound, as a count
    ```

    Decide `compatible` from the declared metadata. There is no other way: neither secret is
    here, so it cannot be settled by trying the switch and seeing whether the result
    decrypts — and a system that settled it that way would need the secrets in the one place
    they must not be.

    Entry noise is in -1..1 here. noiseAdded=len(sample["mask"])*levels*(base-1).
    This is an absolute additional-error bound, not the measured error.
    Compatibility compares sourceDimension with len(mask), key modulus/base/levels
    with params, and non-None sample keyId with sourceKeyId. Missing/None keyId
    is allowed. An incompatible key makes key_switch raise ValueError.
    """
    return {}


def extraction_counterexample(params: dict, index: int) -> dict:
    """Construct synthetic coefficient arrays a,b and a binary test key secret, each of degree entries. a/b contain integer remainders0..q-1. Inputs guarantee degree>=2, modulus>=3 and index in0..degree-2. Correct extraction and extraction omitting every wrap sign must have different phases there, but agree at degree-1. The checker calculates independently of your functions. See the free statement for formulas and an arithmetic example."""
    return {}
