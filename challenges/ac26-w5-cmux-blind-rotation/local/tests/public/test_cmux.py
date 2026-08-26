"""Public tests. They show the shape of an answer; they do not prove one correct.

They run one CMUX on one parameter set, one rotation, and one blind rotation compared
against the loop's own arithmetic. A rotation direction that is reversed everywhere passes
all of it — so does a CMUX that hands back `ct1`, because selector 1 is the case a learner
tests first.

The hidden tests compare the blind rotation against a plaintext model built without calling
anything you wrote, and they check selector 0 as carefully as selector 1.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import cmux as submission  # noqa: E402

# The supplied half of the problem, and only that: the ring, RLWE, RGSW and the external
# product this problem does not ask you to write. It ships in the participant image;
# `fixtures/generate.py`, which implements the eight graded names, does not.
from participant.ring import (  # noqa: E402
    rgsw_encrypt,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_trivial,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's parameters, secrets, sample, key material and test vector.

    Issue 543 option B2: this file used to import `fixtures.generate` directly. That module
    derives a deployment's rotation table, CMUX rows and blind-rotation trace, which it
    cannot do without working `rlwe_add`, `rlwe_sub`, `cmux`, `monomial_rotate`,
    `rotate_ciphertext`, `conditional_rotate`, `blind_rotate` and `blind_rotate_trace` --
    the eight names `starter/cmux.py` asks the learner to write. It does not ship in the
    `participant` Docker stage any more (see ../../Dockerfile), so this deployment's own
    verifier is the only source for the values below: `PUBLIC_EVIDENCE_JSON` when
    `participant/server.py` has already fetched it (the Portal path, which the sandboxed
    run behind `make test` also takes), `VERIFIER_PUBLIC_URL` fetched directly when it has
    not.
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
            # Same message as show.py, for the same reason: an unreachable verifier is a
            # torn-down deployment, not a failing submission, and a urllib traceback reads
            # like the latter.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The parameters these tests run on live there since Issue 543 option B2. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this only resolves where `fixtures/` is actually on disk, which is a
    # checkout (this file run directly, e.g. by
    # scripts/ac26-w5-cmux-blind-rotation.test.ts) or the verifier/author Docker stage, and
    # never inside a built `participant` image -- so this branch existing does not reopen
    # the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _public_payload()
INPUTS = PUBLIC["testInputs"]


def params(_seed: str = SEED) -> dict:
    """The deployment's parameters, as served. Signature kept so the checks read the same."""
    return dict(PUBLIC["params"])


def _material(payload: dict) -> dict:
    return {
        "masks": tuple(tuple(mask) for mask in payload["masks"]),
        "noises": tuple(tuple(noise) for noise in payload["noises"]),
    }


def _pair(par: dict) -> tuple:
    secret = tuple(INPUTS["secret"])
    pair = INPUTS["pair"]
    m0, m1 = tuple(pair["m0"]), tuple(pair["m1"])
    ciphertexts = tuple(
        rlwe_encrypt(par, secret, messages, tuple(pair["masks"][which]), tuple(pair["noises"][which]))
        for which, messages in enumerate((m0, m1))
    )
    return secret, m0, m1, ciphertexts


def check_rotation_by_zero_is_identity() -> str:
    par = params(SEED)
    poly = tuple(INPUTS["publicMask"])
    if tuple(submission.monomial_rotate(par, poly, 0)) != tuple(poly):
        return "rotating by zero changed the polynomial"
    return ""


def check_rotation_wraps_with_a_sign() -> str:
    par = params(SEED)
    poly = tuple(INPUTS["publicMask"])
    got = tuple(submission.monomial_rotate(par, poly, par["degree"]))
    want = tuple((-value) % par["modulus"] for value in poly)
    if got != want:
        return "rotating by N did not negate the polynomial"
    return ""


def check_selector_one_takes_the_second_branch() -> str:
    par = params(SEED)
    secret, _, m1, (ct0, ct1) = _pair(par)
    rgsw = rgsw_encrypt(par, secret, 1, _material(INPUTS["rgswMaterial"]))
    product = submission.cmux(par, rgsw, ct0, ct1)
    got = rlwe_decrypt(par, secret, {"a": tuple(product["a"]), "b": tuple(product["b"])})
    if got != m1:
        return f"selector 1 gave {got}, not the second branch {m1}"
    return ""


def check_blind_rotation_agrees_with_its_own_steps() -> str:
    """Compares the loop against `conditional_rotate` applied by hand — self-consistency only."""
    par = params(SEED)
    ring_secret = tuple(INPUTS["ringSecret"])
    bits = tuple(INPUTS["lweSecret"])
    # The key is the supplied `rgsw_encrypt` applied to each secret bit -- the same thing
    # `bootstrap_key` did, built here from the material the verifier served.
    key = tuple(
        rgsw_encrypt(par, ring_secret, bit, _material(material))
        for bit, material in zip(bits, INPUTS["bootstrapMaterial"])
    )
    sample = {
        "mask": tuple(INPUTS["sample"]["mask"]),
        "body": INPUTS["sample"]["body"],
        "modulus": INPUTS["sample"]["modulus"],
    }
    accumulator = rlwe_trivial(par, tuple(INPUTS["testVector"]))

    current = submission.rotate_ciphertext(par, accumulator, -sample["body"])
    for index, mask in enumerate(sample["mask"]):
        current = submission.conditional_rotate(par, key[index], current, mask)
    stepwise = rlwe_decrypt(par, ring_secret, {"a": tuple(current["a"]), "b": tuple(current["b"])})

    looped = submission.blind_rotate(par, key, sample, accumulator)
    got = rlwe_decrypt(par, ring_secret, {"a": tuple(looped["a"]), "b": tuple(looped["b"])})
    if got != stepwise:
        return f"the loop gave {got}, its own steps gave {stepwise}"
    # Not `monomial_rotate([0] * N, 0)`: that is one of the graded functions, and this
    # process no longer has an implementation of it that is not the learner's own.
    if got == tuple([0] * par["degree"]):
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
