"""`make inspect` — the gadget, one decomposition, the RGSW row layout, and the product.

    make inspect            selector 1 (the message survives)
    make inspect CASE=0     selector 0 (the message becomes zero)

The secret is not printed, and neither is the selector's plaintext outside the header line
that names which case is being shown. Everything else is what an observer of the protocol
would see.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    decompose,
    decompose_poly,
    external_product,
    external_trace,
    gadget_vector,
    health_token,
    levels_needed,
    noise_bound,
    params,
    recompose,
    rgsw_encrypt,
    rgsw_material,
    ring_noise,
    ring_random,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_secret,
    smallest_unrepresentable,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
# `or` rather than a default argument: the Makefile always passes -e CASE, so an
# unset CASE arrives as the empty string rather than as an absent variable.
CASE = (os.environ.get("CASE") or "1").strip()


def main() -> None:
    par = params(SEED)
    selector = 0 if CASE == "0" else 1
    base, levels, degree, q = par["base"], par["levels"], par["degree"], par["modulus"]

    print("health token :", health_token(SEED))
    print()
    print(f"  base B        {base}")
    print(f"  levels L      {levels}")
    print(f"  modulus q     {q}   = B^L, which is what makes recomposition exact")
    print(f"  ring degree N {degree}")
    print(f"  gadget        {gadget_vector(par)}")
    print(f"  noise bound   {noise_bound(par)}   (budget {par['delta'] // 2})")
    print()

    value = q // 3
    digits = decompose(par, value)
    print(f"  decomposing {value}:")
    print(f"    digits (LSB first)  {digits}")
    print(f"    gadget              {gadget_vector(par)}")
    print(f"    inner product       {recompose(par, digits)}   <- back to {value}")
    print()

    secret = rlwe_secret(SEED, par)
    messages = tuple((i + 1) % par["plaintext_modulus"] for i in range(degree))
    ciphertext = rlwe_encrypt(
        par, secret, messages, ring_random(SEED, par, "show"), ring_noise(SEED, par, "show")
    )
    print(f"  message              {messages}")
    print(f"  ciphertext a         {ciphertext['a']}")
    print(f"  ciphertext b         {ciphertext['b']}")
    print()
    print(f"  decompose(a) gives {levels} ring elements, one per level:")
    for index, level in enumerate(decompose_poly(par, ciphertext["a"])):
        print(f"    level {index}  x B^{index} = {gadget_vector(par)[index]:<8} {level}")
    print("  Each level is a ring element of N coefficients -- not one coefficient's digits.")
    print()

    material = rgsw_material(SEED, par, "show")
    rgsw = rgsw_encrypt(par, secret, selector, material)
    print(f"  RGSW has {len(rgsw)} rows = 2L. Where the gadget term sits:")
    for j in (0, 1, levels - 1, levels, levels + 1, 2 * levels - 1):
        slot = "a" if j < levels else "b"
        power = j if j < levels else j - levels
        print(f"    row {j:<3} gadget[{power}] = {gadget_vector(par)[power]:<8} in the {slot} slot")
    print()

    product = external_product(par, rgsw, ciphertext)
    trace = external_trace(par, rgsw, ciphertext)
    print(f"  external product, selector {selector} (accumulating over {len(trace)} rows):")
    print("    row  slot  level   accumulated_a[0]  accumulated_b[0]")
    for record in trace:
        print(
            f"    {record['row']:<4} {record['slot']:<5} {record['level']:<7}"
            f" {record['accumulated_a'][0]:<17} {record['accumulated_b'][0]}"
        )
    print()
    print(f"  result a             {product['a']}")
    print(f"  result b             {product['b']}")
    print(f"  decrypts to          {rlwe_decrypt(par, secret, product)}")
    print(f"  original message     {messages}")
    print()
    print("  Same arithmetic either way. Nothing in the result says which selector it was.")
    print()

    short = max(1, levels_needed(base, q) - 2)
    witness = smallest_unrepresentable(base, short, q)
    print(f"  with only {short} levels instead of {levels}:")
    print(f"    levels needed for q={q}   {levels_needed(base, q)}")
    print(f"    smallest value that fails  {witness}")
    print("    decompose does not complain about it. It just drops what will not fit.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
