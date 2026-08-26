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

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import lwe as submission  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's parameters, secrets, masks and the one normalize probe.

    Issue 543 option B2: this file used to import `fixtures.generate` directly. That
    module derives a deployment's fixtures, which it cannot do without working
    `normalize`, `ring_mul`, `lwe_encrypt`, `lwe_decrypt`, `rlwe_encrypt`,
    `rlwe_decrypt`, `encode`, `decode` and `centered` -- the eleven names
    `starter/lwe.py` asks the learner to write. It does not ship in the `participant`
    Docker stage any more (see ../../Dockerfile), so this deployment's own verifier is
    the only source for the values below: `PUBLIC_EVIDENCE_JSON` when
    `participant/server.py` has already fetched it (the Portal path, which the sandboxed
    run behind `make test` also takes), `VERIFIER_PUBLIC_URL` fetched directly when it
    has not.
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
                "The parameters and masks these tests run on live there since Issue 543 "
                "option B2. Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this only resolves where `fixtures/` is actually on disk, which is
    # a checkout (this file run directly, e.g. by scripts/ac26-w5-lwe-rlwe.test.ts) or
    # the verifier/author Docker stage, and never inside a built `participant` image --
    # so this branch existing does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _public_payload()


def check_normalize_produces_n_coefficients() -> str:
    par = PUBLIC["params"]
    probe = PUBLIC["inputs"]["normalizeProbe"]
    got = submission.normalize(par, list(probe["input"]))
    if len(tuple(got)) != par["degree"]:
        return f"normalizing produced {len(tuple(got))} coefficients, not {par['degree']}"
    if tuple(got) != tuple(probe["expected"]):
        return "the normalized coefficients do not match the ring"
    return ""


def check_lwe_round_trip() -> str:
    par = PUBLIC["params"]
    secret = tuple(PUBLIC["inputs"]["lweSecret"])
    mask = tuple(PUBLIC["inputs"]["lweMask"])
    for message in range(par["plaintext_modulus"]):
        ciphertext = submission.lwe_encrypt(par, secret, message, mask, 0)
        if submission.lwe_decrypt(par, secret, ciphertext)["message"] != message:
            return f"message {message} did not survive its own round trip"
    return ""


def check_rlwe_round_trip() -> str:
    par = PUBLIC["params"]
    n = par["degree"]
    secret = tuple(PUBLIC["inputs"]["rlweSecret"])
    mask = tuple(PUBLIC["inputs"]["rlweMask"])
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
