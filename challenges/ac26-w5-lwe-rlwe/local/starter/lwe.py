"""The only file you edit.

Two encryption schemes with the same shape and different arithmetic.

```text
LWE    secret s in {0,1}^n           b = <a, s> + encode(m) + e   (mod q)
RLWE   secret S in R_q, 0/1 coeffs   B = A * S + encode(M) + E    (in R_q)
```

Something times the secret, plus the encoded message, plus noise — both times. What
changes is the operation and the payload. RLWE is **not** LWE with longer vectors: the
product is a different product, and one RLWE ciphertext carries N messages rather than one.

The ring is `R_q = Z_q[X] / (X^N + 1)`, so:

    X^N = -1

A coefficient that wraps past degree N comes back **negated**. That single sign is the
difference between a negacyclic product and a cyclic one, and a cyclic ring is perfectly
self-consistent — it will round-trip your own tests happily. `participant.wrong_ring.cyclic_mul`
is the wrong one, written out, so you can compare against a stated weakness rather than
against code you deliberately broke. `make inspect` prints both products of the same
input, side by side.

`encode`, `decode`, and `centered` are the same as in `ac26-w5-encoding-noise`, ties
included: an exact half-way value rounds **up**, so the tolerated interval is asymmetric
when `delta` is even.

Encryption takes its mask and its noise as arguments rather than sampling them. This makes
every run reproducible without a CSPRNG, which this problem is not about. A real
implementation samples both — and reusing a mask across two encryptions under one key is a
break, not a shortcut.

`params` carries `degree`, `dimension`, `plaintext_modulus`, `delta`, and `modulus`, and
they all change between checkpoints. Anything you hardcode is wrong somewhere.

Run `make inspect` first.

None of this is secure. n, N and q are small enough to enumerate, and the secret is
recoverable from a handful of samples by linear algebra. It is a toy of the mechanism.
"""

from __future__ import annotations


def encode(params: dict, m: int) -> int:
    """m * delta, in the ring. Same as the previous problem."""
    return 0


def decode(params: dict, c: int) -> int:
    """Nearest encoding point, ties rounding up."""
    return 0


def centered(params: dict, x: int) -> int:
    """The representative in [-(q // 2), (q - 1) // 2]."""
    return 0


# ---------------------------------------------------------------------------
# The ring
# ---------------------------------------------------------------------------


def normalize(params: dict, coefficients) -> tuple[int, ...]:
    """Fold to degree < N using X^N = -1, then reduce coefficients into [0, q).

    The input may be any length, including longer than 2N, and may hold negative values.
    Think about what happens to a coefficient that wraps **twice**.

    Return exactly N coefficients.
    """
    return ()


def ring_add(params: dict, a, b) -> tuple[int, ...]:
    return ()


def ring_sub(params: dict, a, b) -> tuple[int, ...]:
    return ()


def ring_mul(params: dict, a, b) -> tuple[int, ...]:
    """The negacyclic product. Schoolbook is fine — no NTT is needed or wanted here."""
    return ()


# ---------------------------------------------------------------------------
# LWE
# ---------------------------------------------------------------------------


def lwe_encrypt(params: dict, secret, message: int, mask, noise: int) -> dict:
    """Return `{"a": ..., "b": ...}` and nothing else.

    Putting the message or the secret in the returned object would make every round-trip
    test you write pass while the scheme encrypts nothing.
    """
    return {}


def lwe_decrypt(params: dict, secret, ciphertext: dict) -> dict:
    """Return `{"phase", "centered_phase", "message", "noise"}`.

    The phase is what is left once the secret is cancelled. Watch the sign — getting it
    backwards still decrypts correctly whenever the product is its own negative, which for
    a small dimension and a binary secret happens more often than you would like.

    `noise` is what remains after the encoded message is taken back out, centered. A real
    decryptor never sees it; it is here so the budget is watchable.
    """
    return {}


# ---------------------------------------------------------------------------
# RLWE
# ---------------------------------------------------------------------------


def rlwe_encrypt(params: dict, secret, messages, mask, noise) -> dict:
    """Same three terms, in the ring. `messages` has one entry per coefficient."""
    return {}


def rlwe_decrypt(params: dict, secret, ciphertext: dict) -> dict:
    """Same four keys as `lwe_decrypt`, with N values in each instead of one."""
    return {}


# ---------------------------------------------------------------------------
# What the two have in common, and what they do not
# ---------------------------------------------------------------------------


def correspondence(params: dict, lwe, rlwe) -> dict:
    """A structured side-by-side of one LWE and one RLWE decryption.

    Each argument is `{"secret": ..., "ciphertext": ...}`. Return, for each scheme:

        secret_kind      "vector" or "polynomial"
        mask_kind        same
        operation        what is actually computed against the secret
        payload_size     how many messages this one ciphertext carries
        phase, centered_phase, noise, message

    The labels are graded. Naming the RLWE operation an inner product is a claim, and it
    is a false one.
    """
    return {}


# ---------------------------------------------------------------------------
# The noise boundary
# ---------------------------------------------------------------------------


def survives(params: dict, noise: int) -> bool:
    """Whether a phase carrying this much noise still decodes to its own message."""
    return False


def first_crossing(params: dict, samples) -> int:
    """The `index` of the first sample **in the given order** whose noise is out of budget.

    Each sample is a dict with at least `index` and `noise`. The samples are not sorted by
    magnitude. Return -1 when every one of them survives.
    """
    return -1


# ---------------------------------------------------------------------------
# Malformed input
# ---------------------------------------------------------------------------


def validate_ciphertext(params: dict, kind: str, ciphertext: dict) -> list[str]:
    """Reasons this ciphertext cannot be used, empty when it can.

    `kind` is `"lwe"` or `"rlwe"`, and it decides how long `a` and `b` have to be. Both
    have to be in canonical form — think about what goes wrong if a negative coefficient,
    or a coefficient equal to q, is let through.
    """
    return []
