"""`make inspect` — the extraction mapping, the switch, and what survives both.

    make inspect            coefficient 0
    make inspect INDEX=2    any coefficient of the ring

Coefficient 0 is the default because it is where the negacyclic sign fires hardest: a slot
wraps when its secret index is above the extracted one, so at index 0 every slot but one
wraps. Run it again with `INDEX` set to the last coefficient and the `sign` column goes
all `+` — that index is the only one in the ring where nothing wraps, and the only one a
sign-blind extraction gets right.

The secrets are used only to print the phases at the bottom, which is the author's view.
Nothing in the extraction or the switch above them touches a key.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    decode,
    decompose_mask,
    domain_report,
    extract_sample,
    extract_trace,
    health_token,
    key_id,
    key_switch,
    lwe_decrypt,
    lwe_phase_of,
    noise_bound,
    params,
    phase_coefficient,
    rlwe_secret,
    rotated_accumulator,
    switching_key,
    target_secret,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    par = params(SEED)
    degree = par["degree"]
    try:
        # `or` rather than a default argument: the Makefile always passes -e INDEX, so an
        # unset INDEX arrives as the empty string rather than as an absent variable.
        index = int(os.environ.get("INDEX") or "0")
    except ValueError:
        index = 0
    index = max(0, min(index, degree - 1))

    print("health token :", health_token(SEED))
    print()
    print(f"  base B            {par['base']}")
    print(f"  levels L          {par['levels']}")
    print(f"  modulus q         {par['modulus']}   = B^L")
    print(f"  ring degree N     {degree}       <- the extracted sample's dimension")
    print(f"  target dimension  {par['target_dimension']}       <- where the switch lands")
    print(f"  plaintext mod     {par['plaintext_modulus']}   (delta {par['delta']})")
    print(f"  noise bound       {noise_bound(par)}   (budget {par['delta'] // 2})")
    print()

    ring_key = rlwe_secret(SEED, par, "ring")
    target = target_secret(SEED, par, "target")
    source_id, target_id = key_id(SEED, "ring"), key_id(SEED, "target")
    accumulator = rotated_accumulator(SEED, par, ring_key, "show")

    print("  The accumulator is a real blind-rotation output, noise and all.")
    print(f"    a  {accumulator['a']}")
    print(f"    b  {accumulator['b']}")
    print()

    print(f"  extracting coefficient {index}:")
    print("    target  source  sign  wrapped  value")
    for record in extract_trace(par, accumulator, index):
        print(
            f"    {record['target']:<7} {record['source']:<7} {record['sign']:<+5}"
            f" {str(record['wrapped']):<8} {record['value']}"
        )
    print(f"  The boundary sits at {index}: every slot above it wrapped past the degree,")
    print("  and X^N = -1 is why those come back negated.")
    print()

    sample = dict(extract_sample(par, accumulator, index))
    sample["keyId"] = source_id
    print(f"    extracted mask  {sample['mask']}")
    print(f"    extracted body  {sample['body']}")
    print(f"    its phase       {lwe_phase_of(par, ring_key, sample)}")
    print(f"    the coefficient {phase_coefficient(par, ring_key, accumulator, index)}   <- the same number, exactly")
    print()

    key = switching_key(SEED, par, ring_key, target, source_id, target_id, "show")
    digits = decompose_mask(par, sample["mask"])
    print(f"  decomposing the mask, base {par['base']}, {par['levels']} levels, LSB first:")
    for j, row in enumerate(digits[: min(3, len(digits))]):
        print(f"    coefficient {j}  {sample['mask'][j]:<8} -> {row}")
    if len(digits) > 3:
        print(f"    ... {len(digits) - 3} more")
    print()

    switched = key_switch(par, key, sample)
    report = domain_report(par, sample, key)
    print("  switching keys:")
    for field in (
        "sourceKeyId", "targetKeyId", "sourceDimension", "targetDimension",
        "base", "levels", "compatible", "noiseAdded",
    ):
        print(f"    {field:<18} {report[field]}")
    print()
    print(f"    switched mask   {switched['mask']}")
    print(f"    switched body   {switched['body']}")
    print(f"    now belongs to  {switched['keyId']}")
    print()

    print("  the same message, three ways:")
    print(f"    RLWE coefficient {index}   {decode(par, phase_coefficient(par, ring_key, accumulator, index))}")
    print(f"    extracted, under the ring key   {lwe_decrypt(par, ring_key, sample)}")
    print(f"    switched, under the target key  {lwe_decrypt(par, target, switched)}")
    print()
    print("  Neither step decrypted anything. The extraction was handed no key at all, and")
    print("  the switch saw the source secret only inside the switching key's ciphertexts.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
