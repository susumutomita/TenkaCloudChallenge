"""Public tests. They show the shape of an answer; they do not prove one correct.

They extract the **last** coefficient and switch it. A mask slot wraps when its secret index
is above the extracted index, so at `degree - 1` nothing wraps at all — it is the one index
of the ring where the negacyclic sign never fires, and an extraction that ignores the sign
entirely passes every check here.

Index 0 is the opposite: every slot but one wraps. The hidden tests run every index, and
grade extraction on the phase rather than on the mask, so the vector can be built any way
that preserves the number.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import extract as submission  # noqa: E402

# The supplied half of the problem, and only that: the ring, the gadget and the phases this
# problem does not ask you to write. It ships in the participant image;
# `fixtures/generate.py`, which implements the six graded names, does not.
from participant.ring import decode, lwe_decrypt  # noqa: E402

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_payload() -> dict:
    """This deployment's parameters, secrets, accumulator and switching key.

    Issue 543 option B2: this file used to import `fixtures.generate` directly. That module
    derives a deployment's extraction trace, switched sample and domain report, which it
    cannot do without working `phase_coefficient`, `extract_sample`, `extract_trace`,
    `decompose_mask`, `key_switch` and `domain_report` -- the six names
    `starter/extract.py` asks the learner to write. It does not ship in the `participant`
    Docker stage any more (see ../../Dockerfile), so this deployment's own verifier is the
    only source for the values below: `PUBLIC_EVIDENCE_JSON` when `participant/server.py`
    has already fetched it (the Portal path, which the sandboxed run behind `make test`
    also takes), `VERIFIER_PUBLIC_URL` fetched directly when it has not.
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
    # checkout (this file run directly, e.g. by scripts/ac26-w5-extract-key-switch.test.ts)
    # or the verifier/author Docker stage, and never inside a built `participant` image --
    # so this branch existing does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


PUBLIC = _public_payload()
INPUTS = PUBLIC["testInputs"]


def _scene() -> tuple:
    par = dict(PUBLIC["params"])
    ring_key = tuple(INPUTS["ringKey"])
    target = tuple(INPUTS["targetKey"])
    source_id = PUBLIC["keyIds"]["source"]
    accumulator = {
        "a": tuple(INPUTS["accumulator"]["a"]),
        "b": tuple(INPUTS["accumulator"]["b"]),
    }
    raw = INPUTS["switchingKey"]
    key = dict(raw)
    key["entries"] = tuple(
        tuple({"mask": tuple(entry["mask"]), "body": entry["body"]} for entry in row)
        for row in raw["entries"]
    )
    return par, ring_key, target, source_id, accumulator, key


def check_extraction_preserves_the_last_coefficient() -> str:
    par, ring_key, _, _, accumulator, _ = _scene()
    last = par["degree"] - 1
    sample = submission.extract_sample(par, accumulator, last)
    got = lwe_decrypt(par, ring_key, {"mask": tuple(sample["mask"]), "body": sample["body"]})
    want = submission.phase_coefficient(par, ring_key, accumulator, last)
    if got != decode(par, want):
        return f"the extracted sample decrypts to {got}, the coefficient says {decode(par, want)}"
    return ""


def check_extracted_mask_is_one_slot_per_secret_coefficient() -> str:
    par, _, _, _, accumulator, _ = _scene()
    sample = submission.extract_sample(par, accumulator, par["degree"] - 1)
    if len(tuple(sample["mask"])) != par["degree"]:
        return f"the mask has {len(tuple(sample['mask']))} slots, the ring secret has {par['degree']}"
    return ""


def check_switch_lands_on_the_target_dimension() -> str:
    par, _, _, source_id, accumulator, key = _scene()
    sample = dict(submission.extract_sample(par, accumulator, par["degree"] - 1))
    sample["keyId"] = source_id
    switched = submission.key_switch(par, key, sample)
    if len(tuple(switched["mask"])) != par["target_dimension"]:
        return (
            f"the switched mask has {len(tuple(switched['mask']))} slots, "
            f"the target key has {par['target_dimension']}"
        )
    return ""


def check_switch_keeps_the_message() -> str:
    par, ring_key, target, source_id, accumulator, key = _scene()
    sample = dict(submission.extract_sample(par, accumulator, par["degree"] - 1))
    sample["keyId"] = source_id
    before = lwe_decrypt(par, ring_key, {"mask": tuple(sample["mask"]), "body": sample["body"]})
    switched = submission.key_switch(par, key, sample)
    after = lwe_decrypt(
        par, target, {"mask": tuple(switched["mask"]), "body": switched["body"]}
    )
    if before != after:
        return f"the message was {before} before the switch and {after} after"
    return ""


CHECKS = (
    ("extraction-preserves-the-last-coefficient", check_extraction_preserves_the_last_coefficient),
    ("extracted-mask-is-one-slot-per-secret-coefficient", check_extracted_mask_is_one_slot_per_secret_coefficient),
    ("switch-lands-on-the-target-dimension", check_switch_lands_on_the_target_dimension),
    ("switch-keeps-the-message", check_switch_keeps_the_message),
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
        print("\nEvery check above used the last coefficient, which is the one index of the")
        print("ring where nothing wraps. An extraction that ignores the sign passes all four.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
