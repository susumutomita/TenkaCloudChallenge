"""`make inspect` — the whole pipeline, one stage at a time, on your own fixtures.

    make inspect                the identity table on m = 1
    make inspect F=always-one   any of identity, negate, always-zero, always-one
    make inspect M=0            the other message

`F=identity` is the default and it is the *least* informative run. The negation inverts which
functions are interesting: `identity` and `negate` both satisfy `f(0) + f(1) = 1`, so
`encode(f(1))` and `encode(1 - f(0))` are the same number and the whole accumulator is
constant. A constant polynomial cannot show you where the rotation landed.

Run `F=always-one` second. A *constant function* is the one with a two-valued table, which is
the negation made visible.

The secrets appear only in the phase column at the bottom, which is the author's view.
Nothing in the pipeline above it is handed a key.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    UNARY,
    blind_rotation_noise,
    bootstrap,
    bootstrap_key,
    centered,
    correctness_bound,
    decode,
    health_token,
    homomorphic_nand,
    key_id,
    key_switch_noise,
    lwe_decrypt,
    lwe_encrypt,
    lwe_phase,
    lwe_secret,
    output_noise_bound,
    params,
    pipeline_trace,
    refresh_report,
    ring_secret,
    switching_key,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def main() -> None:
    par = params(SEED)
    name = os.environ.get("F", "identity")
    if name not in UNARY:
        name = "identity"
    function = UNARY[name]
    table = {0: function(0), 1: function(1)}
    try:
        message = 1 if int(os.environ.get("M", "1")) else 0
    except ValueError:
        message = 1

    print("health token :", health_token(SEED))
    print()
    print(f"  parameter set     {par['parameterSetId']}")
    print(f"  base B            {par['base']}")
    print(f"  levels L          {par['levels']}")
    print(f"  modulus q         {par['modulus']}   = B^L")
    print(f"  ring degree N     {par['degree']}       <- rotation domain is Z_{2 * par['degree']}")
    print(f"  LWE dimension n   {par['dimension']}")
    print(f"  encoding          {par['encodingId']}   encode(1) = +q/8 = {par['delta']}, encode(0) = -q/8")
    print()
    print(f"  blind rotation adds at most  {blind_rotation_noise(par)}")
    print(f"  key switch adds at most      {key_switch_noise(par)}")
    print(f"  so a bootstrapped ciphertext {output_noise_bound(par)}")
    print(f"  and one tolerates            {correctness_bound(par)}   <- the correctness bound")
    print()

    ring_key = ring_secret(SEED, par, "ring")
    lwe_key = lwe_secret(SEED, par, "lwe")
    source_id, target_id = key_id(SEED, "ring"), key_id(SEED, "lwe")
    key = bootstrap_key(SEED, par, ring_key, lwe_key, "show")
    switch = switching_key(SEED, par, ring_key, lwe_key, source_id, target_id, "show")

    sample = lwe_encrypt(SEED, par, lwe_key, message, "show")
    sample = {**sample, "keyId": target_id, "dimension": par["dimension"]}

    print(f"  f = {name}, m = {message}, so f(m) = {function(message)}")
    print(f"  the lookup table is {{0: {table[0]}, 1: {table[1]}}}")
    print()

    rows = pipeline_trace(par, key, switch, sample, table)
    print("  stage             kind  dimension  modulus  noise<=  message      where          key")
    for row in rows:
        located = row["located"] or "-"
        says = row["messageIs"] or "none"
        print(
            f"    {row['stage']:<16} {row['kind']:<5} {row['dimension']:<10} {row['modulus']:<8}"
            f" {row['noiseBound']:<8} {says:<12} {located:<14} {row['keyId'][:8]}"
        )
    print()
    print("  Read the noise column down. It stops depending on what came in at blind-rotation:")
    print("  the accumulator is trivial and carries none, so nothing after that row mentions")
    print("  the input. That is the refresh, and it is why the output can go back in.")
    print()
    print("  Read the message column down. The accumulator is the one artifact carrying no")
    print("  message at all -- it carries the function.")
    print()
    print("  public data used   ciphertexts, bootstrapping key, switching key, parameters")
    print("  deliberately held  the LWE secret and the ring secret. No stage is given either.")
    print()

    for row in rows:
        print(f"    {row['stage']:<16} {row['digest']}")
    print("  Those digests name the artifacts this run produced, not a diagram of the pipeline.")
    print()

    result = bootstrap(par, key, switch, sample, table)
    print("  before and after:")
    print(f"    input phase   {centered(par, lwe_phase(par, lwe_key, sample)):>8}  -> decodes {decode(par, lwe_phase(par, lwe_key, sample))}")
    print(f"    output phase  {centered(par, lwe_phase(par, lwe_key, result)):>8}  -> decodes {lwe_decrypt(par, lwe_key, result)}   (f(m) = {function(message)})")
    print(f"    output key    {result['keyId'][:8]}  <- the same key the input came under")
    print(f"    last digest   {rows[-1]['digest']}")
    print()

    report = refresh_report(par, correctness_bound(par) // 2)
    print("  the refresh, as numbers:")
    for field in ("inputNoise", "correctnessBound", "outputNoiseBound", "withinContract", "secondPassFits"):
        print(f"    {field:<18} {report[field]}")
    print("  outputNoiseBound does not mention inputNoise. Change one and the other does not move.")
    print()

    print("  HomNAND, all four rows:")
    for left_bit in (0, 1):
        for right_bit in (0, 1):
            left = lwe_encrypt(SEED, par, lwe_key, left_bit, f"show:{left_bit}{right_bit}:l")
            right = lwe_encrypt(SEED, par, lwe_key, right_bit, f"show:{left_bit}{right_bit}:r")
            left = {**left, "keyId": target_id}
            right = {**right, "keyId": target_id}
            gate = homomorphic_nand(par, key, switch, left, right)
            combined = centered(
                par,
                (par["delta"] - lwe_phase(par, lwe_key, left) - lwe_phase(par, lwe_key, right))
                % par["modulus"],
            )
            print(
                f"    NAND({left_bit},{right_bit}) = {lwe_decrypt(par, lwe_key, gate)}"
                f"   combined phase {combined:>8}  ({'+' if combined > 0 else '-'})"
            )
    print()
    print("  The sign of that phase is the gate. One linear combination, then one bootstrap")
    print("  with the identity table -- there is no plaintext NAND anywhere in it.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
