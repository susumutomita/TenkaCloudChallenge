"""Public tests. They show the shape of an answer; they do not prove one correct.

They run one CMUX on one parameter set, one rotation, and one blind rotation compared
against the loop's own arithmetic. A rotation direction that is reversed everywhere passes
all of it — so does a CMUX that hands back `ct1`, because selector 1 is the case a learner
tests first.

The hidden tests compare the blind rotation against a plaintext model built without calling
anything you wrote, and they check selector 0 as carefully as selector 1.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import cmux as submission  # noqa: E402
from fixtures.generate import (  # noqa: E402
    bootstrap_key,
    lwe_sample,
    lwe_secret,
    monomial_rotate,
    params,
    rgsw_encrypt,
    rgsw_material,
    ring_noise,
    ring_random,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_secret,
    rlwe_trivial,
    test_vector,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _pair(par: dict) -> tuple:
    secret = rlwe_secret(SEED, par)
    m0 = tuple((index + 1) % par["plaintext_modulus"] for index in range(par["degree"]))
    m1 = tuple((value + 2) % par["plaintext_modulus"] for value in m0)
    ciphertexts = tuple(
        rlwe_encrypt(par, secret, messages, ring_random(SEED, par, f"pub{which}"), ring_noise(SEED, par, f"pub{which}"))
        for which, messages in enumerate((m0, m1))
    )
    return secret, m0, m1, ciphertexts


def check_rotation_by_zero_is_identity() -> str:
    par = params(SEED)
    poly = ring_random(SEED, par, "public")
    if tuple(submission.monomial_rotate(par, poly, 0)) != tuple(poly):
        return "rotating by zero changed the polynomial"
    return ""


def check_rotation_wraps_with_a_sign() -> str:
    par = params(SEED)
    poly = ring_random(SEED, par, "public")
    got = tuple(submission.monomial_rotate(par, poly, par["degree"]))
    want = tuple((-value) % par["modulus"] for value in poly)
    if got != want:
        return "rotating by N did not negate the polynomial"
    return ""


def check_selector_one_takes_the_second_branch() -> str:
    par = params(SEED)
    secret, _, m1, (ct0, ct1) = _pair(par)
    rgsw = rgsw_encrypt(par, secret, 1, rgsw_material(SEED, par, "pub"))
    product = submission.cmux(par, rgsw, ct0, ct1)
    got = rlwe_decrypt(par, secret, {"a": tuple(product["a"]), "b": tuple(product["b"])})
    if got != m1:
        return f"selector 1 gave {got}, not the second branch {m1}"
    return ""


def check_blind_rotation_agrees_with_its_own_steps() -> str:
    """Compares the loop against `conditional_rotate` applied by hand — self-consistency only."""
    par = params(SEED)
    ring_secret = rlwe_secret(SEED, par, "ring")
    bits = lwe_secret(SEED, par)
    key = bootstrap_key(SEED, par, ring_secret, bits)
    sample = lwe_sample(SEED, par, bits)
    accumulator = rlwe_trivial(par, test_vector(SEED, par))

    current = submission.rotate_ciphertext(par, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = submission.conditional_rotate(par, key[index], current, mask)
    stepwise = rlwe_decrypt(par, ring_secret, {"a": tuple(current["a"]), "b": tuple(current["b"])})

    looped = submission.blind_rotate(par, key, sample, accumulator)
    got = rlwe_decrypt(par, ring_secret, {"a": tuple(looped["a"]), "b": tuple(looped["b"])})
    if got != stepwise:
        return f"the loop gave {got}, its own steps gave {stepwise}"
    if got == tuple(monomial_rotate(par, [0] * par["degree"], 0)):
        return "the blind rotation decrypted to all zeroes"
    return ""


CHECKS = (
    ("rotation-by-zero-is-identity", check_rotation_by_zero_is_identity),
    ("rotation-wraps-with-a-sign", check_rotation_wraps_with_a_sign),
    ("selector-one-takes-the-second-branch", check_selector_one_takes_the_second_branch),
    ("blind-rotation-agrees-with-its-own-steps", check_blind_rotation_agrees_with_its_own_steps),
)


def main(argv: list[str]) -> int:
    only = argv[argv.index("--only") + 1] if "--only" in argv else ""
    failed = 0
    for name, check in CHECKS:
        if only and only not in name:
            continue
        try:
            message = check()
        except Exception as error:  # noqa: BLE001 - a crash is a failure, reported as one
            message = f"raised {type(error).__name__}"
        if message:
            print(f"FAIL {name}: {message}")
            failed += 1
        else:
            print(f"ok   {name}")
    print(f"\npublic tests: {failed} failed" if failed else "\npublic tests: all passed")
    if not failed:
        print("\nNothing here checked selector 0, and the last check compared the loop")
        print("against itself. A reversed rotation direction survives both.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
