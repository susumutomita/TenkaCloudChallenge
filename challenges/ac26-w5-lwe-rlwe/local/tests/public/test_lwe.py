"""Public tests. They show the shape of an answer; they do not prove one correct.

They encrypt and decrypt with your own functions, on one parameter set. That is exactly
the test that cannot catch the interesting bugs: a sign-flipped inner product cancels
against a sign-flipped phase, and a cyclic ring is perfectly consistent with itself. Both
pass this file completely.

The hidden tests run every round trip **crossed** against the fixtures — encrypt here,
decrypt there, and the other way round — which is what a self-consistent wrong scheme
cannot survive.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import lwe as submission  # noqa: E402
from fixtures.generate import (  # noqa: E402
    lwe_mask,
    lwe_secret,
    normalize as reference_normalize,
    params,
    rlwe_mask,
    rlwe_secret,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def check_normalize_produces_n_coefficients() -> str:
    par = params(SEED)
    got = submission.normalize(par, list(range(3 * par["degree"])))
    if len(tuple(got)) != par["degree"]:
        return f"normalizing produced {len(tuple(got))} coefficients, not {par['degree']}"
    if tuple(got) != reference_normalize(par, list(range(3 * par["degree"]))):
        return "the normalized coefficients do not match the ring"
    return ""


def check_lwe_round_trip() -> str:
    par = params(SEED)
    secret = lwe_secret(SEED, par)
    mask = lwe_mask(SEED, par, "public")
    for message in range(par["plaintext_modulus"]):
        ciphertext = submission.lwe_encrypt(par, secret, message, mask, 0)
        if submission.lwe_decrypt(par, secret, ciphertext)["message"] != message:
            return f"message {message} did not survive its own round trip"
    return ""


def check_rlwe_round_trip() -> str:
    par = params(SEED)
    n = par["degree"]
    secret = rlwe_secret(SEED, par)
    mask = rlwe_mask(SEED, par, "public")
    messages = tuple((position + 1) % par["plaintext_modulus"] for position in range(n))
    ciphertext = submission.rlwe_encrypt(par, secret, messages, mask, [0] * n)
    if tuple(submission.rlwe_decrypt(par, secret, ciphertext)["message"]) != messages:
        return "the RLWE messages did not survive their own round trip"
    return ""


CHECKS = (
    ("normalize-produces-n-coefficients", check_normalize_produces_n_coefficients),
    ("lwe-round-trip", check_lwe_round_trip),
    ("rlwe-round-trip", check_rlwe_round_trip),
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
        print("\nYour scheme agrees with itself. The checkpoints ask it to agree with the ring.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
