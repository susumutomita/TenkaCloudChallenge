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

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "starter"))

import extract as submission  # noqa: E402
from fixtures.generate import (  # noqa: E402
    key_id,
    lwe_decrypt,
    params,
    rlwe_secret,
    rotated_accumulator,
    switching_key,
    target_secret,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _scene() -> tuple:
    par = params(SEED)
    ring_key = rlwe_secret(SEED, par, "ring")
    target = target_secret(SEED, par, "target")
    source_id, target_id = key_id(SEED, "ring"), key_id(SEED, "target")
    accumulator = rotated_accumulator(SEED, par, ring_key)
    key = switching_key(SEED, par, ring_key, target, source_id, target_id, "public")
    return par, ring_key, target, source_id, accumulator, key


def check_extraction_preserves_the_last_coefficient() -> str:
    par, ring_key, _, _, accumulator, _ = _scene()
    last = par["degree"] - 1
    sample = submission.extract_sample(par, accumulator, last)
    got = lwe_decrypt(par, ring_key, {"mask": tuple(sample["mask"]), "body": sample["body"]})
    want = submission.phase_coefficient(par, ring_key, accumulator, last)
    from fixtures.generate import decode

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
