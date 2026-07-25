"""`make inspect` — the ring, one LWE trace, one RLWE trace, and the boundary samples.

    make inspect                 both schemes
    make inspect MODE=lwe        just LWE
    make inspect MODE=rlwe       just RLWE

The secret is **not** printed. Neither trace needs it to be readable, and a trace that
shows the key teaches the wrong reflex. `MODE=debug` opts in explicitly.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    boundary_samples,
    centered,
    cyclic_mul,
    encode,
    health_token,
    lwe_decrypt,
    lwe_encrypt,
    lwe_mask,
    lwe_secret,
    params,
    ring_mul,
    rlwe_decrypt,
    rlwe_encrypt,
    rlwe_mask,
    rlwe_secret,
    small_noise,
    success_interval,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
MODE = os.environ.get("MODE", "both").lower()


def _ring(par: dict) -> None:
    n = par["degree"]
    print(f"  R_q = Z_{par['modulus']}[X] / (X^{n} + 1)")
    print(f"  degree N      {n}     X^{n} = -1, so a coefficient that wraps comes back negated")
    print(f"  modulus q     {par['modulus']}  = plaintext modulus {par['plaintext_modulus']} * delta {par['delta']}")
    print(f"  dimension n   {par['dimension']}     (LWE only)")
    low, high = success_interval(par)
    print(f"  noise budget  {low} .. {high}")
    print()

    # The wrap, shown rather than described: X^(N-1) * X.
    top = tuple([0] * (n - 1) + [1])
    x = tuple([0, 1] + [0] * (n - 2)) if n > 1 else (1,)
    print(f"  X^{n - 1} * X  negacyclic -> {ring_mul(par, top, x)}")
    print(f"  X^{n - 1} * X  cyclic     -> {cyclic_mul(par, top, x)}   <- the wrong ring")
    print("  Same inputs, different sign. Everything downstream inherits whichever you pick.")
    print()


def _lwe(par: dict) -> None:
    secret = lwe_secret(SEED, par)
    mask = lwe_mask(SEED, par, "show")
    noise = small_noise(SEED, par, "show", 1)[0]
    message = 1 % par["plaintext_modulus"]
    ciphertext = lwe_encrypt(par, secret, message, mask, noise)
    result = lwe_decrypt(par, secret, ciphertext)
    product = (ciphertext["b"] - result["phase"]) % par["modulus"]

    print("LWE")
    print(f"  message              {message}")
    print(f"  encoded message      {encode(par, message)}")
    print(f"  secret shape         vector of {par['dimension']} bits (not shown)")
    print(f"  mask a               {ciphertext['a']}")
    print(f"  inner product <a,s>  {product}")
    print(f"  noise e              {noise}")
    print(f"  ciphertext b         {ciphertext['b']}   = <a,s> + encoded + e")
    print(f"  phase b - <a,s>      {result['phase']}")
    print(f"  centered phase       {result['centered_phase']}")
    print(f"  decoded              {result['message']}")
    print()


def _rlwe(par: dict) -> None:
    n = par["degree"]
    secret = rlwe_secret(SEED, par)
    mask = rlwe_mask(SEED, par, "show")
    noise = small_noise(SEED, par, "show", n)
    messages = tuple((position + 1) % par["plaintext_modulus"] for position in range(n))
    ciphertext = rlwe_encrypt(par, secret, messages, mask, noise)
    result = rlwe_decrypt(par, secret, ciphertext)
    product = ring_mul(par, ciphertext["a"], secret)

    print("RLWE")
    print(f"  messages             {messages}      <- {n} of them, in one ciphertext")
    print(f"  encoded messages     {tuple(encode(par, m) for m in messages)}")
    print(f"  secret shape         polynomial with {n} bit coefficients (not shown)")
    print(f"  mask A               {ciphertext['a']}")
    print(f"  product A*S          {product}")
    print(f"  noise E              {noise}")
    print(f"  ciphertext B         {ciphertext['b']}   = A*S + encoded + E")
    print(f"  phase B - A*S        {result['phase']}")
    print(f"  centered phase       {result['centered_phase']}")
    print(f"  decoded              {result['message']}")
    print()


def _boundary(par: dict) -> None:
    low, high = success_interval(par)
    print(f"boundary samples (budget {low} .. {high}, order is seed-derived, not sorted):")
    print("    index   noise   decodes")
    for sample in boundary_samples(SEED, par):
        print(f"    {sample['index']:<7} {sample['noise']:<7} {sample['decodes']}")
    print("  Which is the FIRST one out of budget, in this order?")
    print()


def main() -> None:
    par = params(SEED)
    print("health token :", health_token(SEED))
    print()
    _ring(par)
    if MODE in ("both", "lwe", "debug"):
        _lwe(par)
    if MODE in ("both", "rlwe", "debug"):
        _rlwe(par)
    _boundary(par)

    if MODE == "debug":
        # Explicit opt-in, and only here. Seeing the key is occasionally useful while
        # debugging and never useful while learning what the scheme protects.
        print("debug: secrets")
        print(f"  LWE  s = {lwe_secret(SEED, par)}")
        print(f"  RLWE S = {rlwe_secret(SEED, par)}")
        print()

    print("Same shape both times: secret-product + encoded message + noise.")
    print("What differs is the product, and how many messages one ciphertext carries.")
    print()
    print("None of this is secure. n, N and q are small enough to enumerate, and the")
    print("secret falls to linear algebra from a handful of samples.")


if __name__ == "__main__":
    main()
