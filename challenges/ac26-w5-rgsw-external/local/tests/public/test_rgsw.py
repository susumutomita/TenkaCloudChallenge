"""Public tests. They show the shape of an answer; they do not prove one correct.

They decompose, recompose, and run one external product with selector 1, on one parameter
set. A digit order reversed together with a reversed gadget passes all of it — the round
trip cannot see a convention that is wrong consistently. So does an external product that
returns its input, because with selector 1 the plaintext is unchanged.

The hidden tests check the gadget vector directly and cross the RGSW rows against the
fixtures, which is what those two survive until.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import rgsw as submission  # noqa: E402

# The supplied half of the problem, and only that: the ring and the toy RLWE this problem
# does not ask you to write. It ships in the participant image; `fixtures/generate.py`,
# which implements the ten graded names, does not.
from participant.ring import rlwe_decrypt, rlwe_encrypt  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's parameters, secret, mask, noise and RGSW material.

    Issue 543 option B2: this file used to import `fixtures.generate` directly. That
    module derives a deployment's rows, traces and boundary witness, which it cannot do
    without working `gadget_vector`, `decompose`, `recompose`, `decompose_poly`,
    `recompose_poly`, `levels_needed`, `smallest_unrepresentable`, `rgsw_encrypt`,
    `external_product` and `external_trace` -- the ten names `starter/rgsw.py` asks the
    learner to write. It does not ship in the `participant` Docker stage any more (see
    ../../Dockerfile), so this deployment's own verifier is the only source for the values
    below: `PUBLIC_EVIDENCE_JSON` when `participant/server.py` has already fetched it (the
    Portal path, which the sandboxed run behind `make test` also takes),
    `VERIFIER_PUBLIC_URL` fetched directly when it has not.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Same message as show.py, for the same reason: an unreachable verifier is
            # a torn-down deployment, not a failing submission, and a urllib traceback
            # reads like the latter.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The parameters and material these tests run on live there since Issue 543 "
                "option B2. Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this only resolves where `fixtures/` is actually on disk, which is
    # a checkout (this file run directly, e.g. by scripts/ac26-w5-rgsw-external.test.ts)
    # or the verifier/author Docker stage, and never inside a built `participant` image --
    # so this branch existing does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _public_payload()


def _material() -> dict:
    raw = PUBLIC["inputs"]["rgswMaterial"]
    return {
        "masks": tuple(tuple(mask) for mask in raw["masks"]),
        "noises": tuple(tuple(noise) for noise in raw["noises"]),
    }


def check_decompose_round_trips() -> str:
    par = PUBLIC["params"]
    for value in (0, 1, par["modulus"] // 3, par["modulus"] - 1):
        digits = submission.decompose(par, value)
        if len(tuple(digits)) != par["levels"]:
            return f"decomposing {value} gave {len(tuple(digits))} digits, not {par['levels']}"
        if submission.recompose(par, digits) != value:
            return f"{value} did not survive decompose then recompose"
    return ""


def check_polynomial_round_trips() -> str:
    par = PUBLIC["params"]
    poly = tuple(PUBLIC["inputs"]["publicPoly"])
    rebuilt = tuple(submission.recompose_poly(par, submission.decompose_poly(par, poly)))
    if rebuilt != tuple(poly):
        return "a polynomial did not survive decompose then recompose"
    return ""


def check_selector_one_keeps_the_message() -> str:
    par = PUBLIC["params"]
    secret = tuple(PUBLIC["inputs"]["secret"])
    messages = tuple((i + 1) % par["plaintext_modulus"] for i in range(par["degree"]))
    ciphertext = rlwe_encrypt(
        par,
        secret,
        messages,
        tuple(PUBLIC["inputs"]["mask"]),
        tuple(PUBLIC["inputs"]["noise"]),
    )
    rows = submission.rgsw_encrypt(par, secret, 1, _material())
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
