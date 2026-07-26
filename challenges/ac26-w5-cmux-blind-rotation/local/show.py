"""`make inspect` — the rotation rule, one CMUX, and the whole blind rotation step by step.

    make inspect            the accumulator's own LWE sample
    make inspect CASE=0     the same run with the bootstrapping key encrypting all zeroes

CASE=0 is worth a look. Every CMUX holds rather than rotates, so the whole rotation comes
from the public offset -- and yet each step's output digest still differs from the candidate
it selected. The plaintext held; the ciphertext did not. That is the cost, and the cover.

Neither secret is printed. The phase is printed once, at the end, next to the plaintext
reference model — that is the author's view, and it is exactly the number blind rotation
reaches without ever computing it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    blind_rotate,
    blind_rotate_trace,
    bootstrap_key,
    cmux,
    decode,
    digest,
    encode,
    health_token,
    lwe_phase,
    lwe_sample,
    lwe_secret,
    monomial_rotate,
    noise_bound,
    params,
    reference_model,
    rgsw_encrypt,
    rgsw_material,
    ring_noise,
    ring_random,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_secret,
    rlwe_trivial,
    test_vector,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
# `or` rather than a default argument: the Makefile always passes -e CASE, so an
# unset CASE arrives as the empty string rather than as an absent variable.
CASE = (os.environ.get("CASE") or "1").strip()


def main() -> None:
    par = params(SEED)
    degree, q = par["degree"], par["modulus"]

    print("health token :", health_token(SEED))
    print()
    print(f"  base B          {par['base']}")
    print(f"  levels L        {par['levels']}")
    print(f"  modulus q       {q}   = B^L")
    print(f"  ring degree N   {degree}")
    print(f"  LWE dimension   {par['dimension']}")
    print(f"  plaintext mod   {par['plaintext_modulus']}   (delta {par['delta']})")
    print(f"  noise bound     {noise_bound(par)}   (budget {par['delta'] // 2})")
    print()

    print("  X^(2N) = 1 and X^N = -1, so an exponent is normalized modulo 2N and one wrap")
    print("  flips the sign. Rotating (1, 0, ...) through a full turn:")
    unit = tuple([1] + [0] * (degree - 1))
    for k in range(2 * degree + 1):
        print(f"    X^{k:<3} * (1, 0, ...) = {monomial_rotate(par, unit, k)}")
    print(f"    X^-1 is X^{2 * degree - 1}: {monomial_rotate(par, unit, -1)}")
    print()

    secret = rlwe_secret(SEED, par)
    m0 = tuple((i + 1) % par["plaintext_modulus"] for i in range(degree))
    m1 = tuple((v + 2) % par["plaintext_modulus"] for v in m0)
    ct0 = rlwe_encrypt(par, secret, m0, ring_random(SEED, par, "s0"), ring_noise(SEED, par, "s0"))
    ct1 = rlwe_encrypt(par, secret, m1, ring_random(SEED, par, "s1"), ring_noise(SEED, par, "s1"))
    print(f"  branch 0 carries {m0}")
    print(f"  branch 1 carries {m1}")
    print("    selector  output digest   decrypts to   equals ct0 / ct1?")
    for selector in (0, 1):
        rgsw = rgsw_encrypt(par, secret, selector, rgsw_material(SEED, par, f"show{selector}"))
        out = cmux(par, rgsw, ct0, ct1)
        same = (out["a"], out["b"]) in ((ct0["a"], ct0["b"]), (ct1["a"], ct1["b"]))
        print(
            f"    {selector:<9} {digest(par, out):<15} {rlwe_decrypt(par, secret, out)}"
            f"   {'yes' if same else 'no'}"
        )
    print("  Neither one. The external product adds fresh noise on both paths, so the")
    print("  output is a new ciphertext either way -- which is what stops the result")
    print("  from saying which branch was taken.")
    print()

    ring_secret = rlwe_secret(SEED, par, "ring")
    bits = lwe_secret(SEED, par) if CASE != "0" else tuple([0] * par["dimension"])
    key = bootstrap_key(SEED, par, ring_secret, bits, "show")
    sample = lwe_sample(SEED, par, bits, "show")
    plaintext = test_vector(SEED, par, "show")
    accumulator = rlwe_trivial(par, plaintext)

    print(f"  accumulator plaintext  {plaintext}")
    print(f"  LWE mask               {sample['mask']}   over Z_{sample['modulus']}")
    print(f"  LWE body               {sample['body']}   (public)")
    print()
    print("  blind rotation, step by step:")
    print("    step  coefficient  exponent  selector       candidate0    candidate1    output")
    for record in blind_rotate_trace(par, key, sample, accumulator):
        print(
            f"    {record['step']:<5} {record['mask']:<12} {record['exponent']:<9}"
            f" {record['selector']:<14} {record['candidate0']}  {record['candidate1']}"
            f"  {record['output']}"
        )
    print("  Step 0 is the public offset: `body` is not a secret, so there is no encrypted")
    print("  choice and both candidates are the same ciphertext. Every later step is a real")
    print("  CMUX, and its output matches neither candidate.")
    print()

    result = blind_rotate(par, key, sample, accumulator)
    print(f"  decrypts to            {rlwe_decrypt(par, ring_secret, result)}")
    print(f"  plaintext model        {reference_model(par, bits, sample, plaintext)}")
    print(f"  phase (author's view)  {lwe_phase(par, bits, sample)}")
    rotated = monomial_rotate(par, [encode(par, m) for m in plaintext], -lwe_phase(par, bits, sample))
    print(f"  X^(-phase) * accumulator decodes to {tuple(decode(par, v) for v in rotated)}")
    print()
    print("  Nothing in the loop computed that phase. It cannot: the secret is only ever")
    print("  present as 2L rows of ciphertext per bit.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
