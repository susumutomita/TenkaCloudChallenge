"""Public tests. They show the shape of an answer; they do not prove one correct.

They decompose, recompose, and run one external product with selector 1, on one parameter
set. A digit order reversed together with a reversed gadget passes all of it — the round
trip cannot see a convention that is wrong consistently. So does an external product that
returns its input, because with selector 1 the plaintext is unchanged.

The hidden tests check the gadget vector directly and cross the RGSW rows against the
fixtures, which is what those two survive until.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import rgsw as submission  # noqa: E402
from fixtures.generate import (  # noqa: E402
    params,
    rgsw_material,
    ring_noise,
    ring_random,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_secret,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_decompose_round_trips() -> str:
    par = params(SEED)
    for value in (0, 1, par["modulus"] // 3, par["modulus"] - 1):
        digits = submission.decompose(par, value)
        if len(tuple(digits)) != par["levels"]:
            return f"decomposing {value} gave {len(tuple(digits))} digits, not {par['levels']}"
        if submission.recompose(par, digits) != value:
            return f"{value} did not survive decompose then recompose"
    return ""


def check_polynomial_round_trips() -> str:
    par = params(SEED)
    poly = ring_random(SEED, par, "public")
    rebuilt = tuple(submission.recompose_poly(par, submission.decompose_poly(par, poly)))
    if rebuilt != tuple(poly):
        return "a polynomial did not survive decompose then recompose"
    return ""


def check_selector_one_keeps_the_message() -> str:
    par = params(SEED)
    secret = rlwe_secret(SEED, par)
    messages = tuple((i + 1) % par["plaintext_modulus"] for i in range(par["degree"]))
    ciphertext = rlwe_encrypt(
        par, secret, messages, ring_random(SEED, par, "pub"), ring_noise(SEED, par, "pub")
    )
    rows = submission.rgsw_encrypt(par, secret, 1, rgsw_material(SEED, par, "pub"))
    product = submission.external_product(par, rows, ciphertext)
    got = rlwe_decrypt(par, secret, {"a": tuple(product["a"]), "b": tuple(product["b"])})
    if got != messages:
        return f"selector 1 gave {got}, not the original {messages}"
    return ""


CHECKS = (
    ("decompose-round-trips", check_decompose_round_trips),
    ("polynomial-round-trips", check_polynomial_round_trips),
    ("selector-one-keeps-the-message", check_selector_one_keeps_the_message),
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
        print("\nNothing here checked selector 0, and selector 0 is half the construction.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
