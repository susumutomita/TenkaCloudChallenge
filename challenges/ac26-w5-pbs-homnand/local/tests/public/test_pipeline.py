"""Public tests. They show the shape of an answer; they do not prove one correct.

Every check here uses the **identity** table, and the identity table is constant. Its lower
half is `encode(f(1)) = encode(1)`; its upper half is `encode(1 - f(0)) = encode(1)`. Every
coefficient of the accumulator is the same number.

A constant polynomial cannot tell you where the rotation landed. So the identity hides, all
at once: which half of the table each message reaches, whether the two halves are the right
way round, which coefficient the extraction took, and whether the rescaling rounded or
truncated. Four of the shipped mutations pass every check in this file.

`negate` is constant for the same reason -- both halves are `encode(0)`. The tables that are
*not* constant belong to `always-zero` and `always-one`, which is the negation inverting
which functions are worth looking at. The hidden tests run all four.

The NAND checks use `(0,0)` and `(1,1)`, the two rows furthest from the decision boundary.
The offset can be wrong by a lot and still get those two right; `(0,1)` and `(1,0)` are the
rows that pin it, and they are the rows that fail intermittently when it is missing.

The hidden tests run all four unary functions, every coefficient index, and the whole truth
table, at every parameter set.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import pipeline as submission  # noqa: E402
from fixtures.generate import (  # noqa: E402
    bootstrap_key,
    key_id,
    lwe_decrypt,
    lwe_encrypt,
    lwe_secret,
    params,
    ring_secret,
    switching_key,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
IDENTITY = {0: 0, 1: 1}


def _scene() -> tuple:
    par = params(SEED)
    ring_key = ring_secret(SEED, par, "ring")
    lwe_key = lwe_secret(SEED, par, "lwe")
    source_id, target_id = key_id(SEED, "ring"), key_id(SEED, "lwe")
    return (
        par,
        lwe_key,
        source_id,
        target_id,
        bootstrap_key(SEED, par, ring_key, lwe_key, "public"),
        switching_key(SEED, par, ring_key, lwe_key, source_id, target_id, "public"),
    )


def _encrypt(par: dict, lwe_key, target_id: str, message: int, label: str) -> dict:
    sample = lwe_encrypt(SEED, par, lwe_key, message, label)
    return {**sample, "keyId": target_id, "dimension": par["dimension"]}


def _as_lwe(artifact) -> dict:
    return {"mask": tuple(artifact["mask"]), "body": artifact["body"]}


def check_accumulator_is_a_trivial_ciphertext() -> str:
    par, _, source_id, _, _, _ = _scene()
    accumulator = submission.lookup_accumulator(par, IDENTITY, source_id)
    if len(tuple(accumulator["b"])) != par["degree"]:
        return "the accumulator does not have one coefficient per ring slot"
    if any(tuple(accumulator["a"])):
        return "the accumulator has a mask, so it is not a trivial ciphertext"
    return ""


def check_rotation_domain_fits_the_ring_of_exponents() -> str:
    par, lwe_key, _, target_id, _, _ = _scene()
    rescaled = submission.to_rotation_domain(par, _encrypt(par, lwe_key, target_id, 1, "public:1"))
    values = (*tuple(rescaled["mask"]), rescaled["body"])
    if not all(0 <= value < 2 * par["degree"] for value in values):
        return "a rescaled component is outside [0, 2N)"
    return ""


def check_identity_bootstrap_returns_the_same_bit() -> str:
    par, lwe_key, _, target_id, key, switch = _scene()
    for message in (0, 1):
        sample = _encrypt(par, lwe_key, target_id, message, f"public:id:{message}")
        got = submission.bootstrap(par, key, switch, sample, IDENTITY)
        if lwe_decrypt(par, lwe_key, _as_lwe(got)) != message:
            return f"bootstrapping the identity on {message} gave the other bit"
    return ""


def check_bootstrapped_output_is_under_the_input_key() -> str:
    par, lwe_key, _, target_id, key, switch = _scene()
    sample = _encrypt(par, lwe_key, target_id, 1, "public:key")
    got = submission.bootstrap(par, key, switch, sample, IDENTITY)
    if got.get("keyId") != sample["keyId"]:
        return "the output does not name the key the input came under"
    if len(tuple(got["mask"])) != par["dimension"]:
        return f"the output has {len(tuple(got['mask']))} mask slots, the input key has {par['dimension']}"
    return ""


def check_nand_gets_the_two_easy_rows() -> str:
    par, lwe_key, _, target_id, key, switch = _scene()
    for bits, want in (((0, 0), 1), ((1, 1), 0)):
        left = _encrypt(par, lwe_key, target_id, bits[0], f"public:nand:{bits}:l")
        right = _encrypt(par, lwe_key, target_id, bits[1], f"public:nand:{bits}:r")
        got = submission.homomorphic_nand(par, key, switch, left, right)
        if lwe_decrypt(par, lwe_key, _as_lwe(got)) != want:
            return f"NAND{bits} gave {1 - want}"
    return ""


CHECKS = (
    ("accumulator-is-a-trivial-ciphertext", check_accumulator_is_a_trivial_ciphertext),
    ("rotation-domain-fits-the-ring-of-exponents", check_rotation_domain_fits_the_ring_of_exponents),
    ("identity-bootstrap-returns-the-same-bit", check_identity_bootstrap_returns_the_same_bit),
    ("bootstrapped-output-is-under-the-input-key", check_bootstrapped_output_is_under_the_input_key),
    ("nand-gets-the-two-easy-rows", check_nand_gets_the_two_easy_rows),
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
        print("\nEvery check above used the identity table, whose accumulator is constant --")
        print("every coefficient the same number. A constant polynomial cannot show you where")
        print("the rotation landed, so the halves can be swapped, the extraction can take the")
        print("wrong coefficient, and the rescaling can truncate, and all of it passes here.")
        print("The hidden tests run all four unary functions and the whole NAND truth table.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
