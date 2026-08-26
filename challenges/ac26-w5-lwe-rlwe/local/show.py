"""`make inspect` — the ring, one LWE trace, one RLWE trace, and the boundary samples.

    make inspect                 both schemes
    make inspect MODE=lwe        just LWE
    make inspect MODE=rlwe       just RLWE

The secret is **not** printed. Neither trace needs it to be readable, and a trace that
shows the key teaches the wrong reflex. `MODE=debug` opts in explicitly.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
# `or` rather than a default argument: the Makefile always passes -e MODE, so an
# unset MODE arrives as the empty string rather than as an absent variable.
MODE = (os.environ.get("MODE") or "both").lower()


def _public_payload() -> dict:
    """This deployment's public half, and every value printed below.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant`
    Docker stage any more (see local/Dockerfile). It has to define working `normalize`,
    `ring_mul`, `lwe_encrypt`, `lwe_decrypt`, `rlwe_encrypt`, `rlwe_decrypt`, `encode`,
    `decode` and `centered` to derive the numbers below -- exactly the names
    `starter/lwe.py` asks the learner to write -- so leaving it reachable here handed
    over eleven stubs for the price of one import. The verifier, which is the only image
    that still carries `fixtures/`, serves the public half over `GET /public`:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, `VERIFIER_PUBLIC_URL`
    when this process must fetch it itself.
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
            # Compose health-gates the workbench on the verifier, so this normally
            # cannot happen. When it does -- a `docker compose run` against a torn-down
            # deployment -- say which service is missing instead of printing a urllib
            # traceback at somebody trying to read their fixtures.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 543 option B2. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _tuple(values) -> tuple:
    """JSON has no tuple, so a payload fetched over `GET /public` hands back lists.

    Every vector and polynomial below was printed as a tuple before the split, and the
    shape of a ring element is part of what the trace is teaching.
    """
    return tuple(values)


def _ring(payload: dict) -> None:
    par = payload["params"]
    n = par["degree"]
    print(f"  R_q = Z_{par['modulus']}[X] / (X^{n} + 1)")
    print(f"  degree N      {n}     X^{n} = -1, so a coefficient that wraps comes back negated")
    print(f"  modulus q     {par['modulus']}  = plaintext modulus {par['plaintext_modulus']} * delta {par['delta']}")
    print(f"  dimension n   {par['dimension']}     (LWE only)")
    low, high = payload["interval"]
    print(f"  noise budget  {low} .. {high}")
    print()

    # The wrap, shown rather than described: X^(N-1) * X.
    ring = payload["ring"]
    print(f"  X^{n - 1} * X  negacyclic -> {_tuple(ring['negacyclic'])}")
    print(f"  X^{n - 1} * X  cyclic     -> {_tuple(ring['cyclic'])}   <- the wrong ring")
    print("  Same inputs, different sign. Everything downstream inherits whichever you pick.")
    print("  The cyclic product is written out in participant/wrong_ring.py.")
    print()


def _lwe(payload: dict) -> None:
    par = payload["params"]
    trace = payload["lwe"]
    print("LWE")
    print(f"  message              {trace['message']}")
    print(f"  encoded message      {trace['encoded']}")
    print(f"  secret shape         vector of {par['dimension']} bits (not shown)")
    print(f"  mask a               {_tuple(trace['mask'])}")
    print(f"  inner product <a,s>  {trace['product']}")
    print(f"  noise e              {trace['noise']}")
    print(f"  ciphertext b         {trace['body']}   = <a,s> + encoded + e")
    print(f"  phase b - <a,s>      {trace['phase']}")
    print(f"  centered phase       {trace['centeredPhase']}")
    print(f"  decoded              {trace['decoded']}")
    print()


def _rlwe(payload: dict) -> None:
    par = payload["params"]
    n = par["degree"]
    trace = payload["rlwe"]
    print("RLWE")
    print(f"  messages             {_tuple(trace['messages'])}      <- {n} of them, in one ciphertext")
    print(f"  encoded messages     {_tuple(trace['encoded'])}")
    print(f"  secret shape         polynomial with {n} bit coefficients (not shown)")
    print(f"  mask A               {_tuple(trace['mask'])}")
    print(f"  product A*S          {_tuple(trace['product'])}")
    print(f"  noise E              {_tuple(trace['noise'])}")
    print(f"  ciphertext B         {_tuple(trace['body'])}   = A*S + encoded + E")
    print(f"  phase B - A*S        {_tuple(trace['phase'])}")
    print(f"  centered phase       {_tuple(trace['centeredPhase'])}")
    print(f"  decoded              {_tuple(trace['decoded'])}")
    print()


def _boundary(payload: dict) -> None:
    low, high = payload["interval"]
    print(f"boundary samples (budget {low} .. {high}, order is seed-derived, not sorted):")
    print("    index   noise   decodes")
    for sample in payload["boundary"]:
        print(f"    {sample['index']:<7} {sample['noise']:<7} {sample['decodes']}")
    print("  Which is the FIRST one out of budget, in this order?")
    print()


def main() -> None:
    payload = _public_payload()
    print("health token :", payload["healthToken"])
    print()
    _ring(payload)
    if MODE in ("both", "lwe", "debug"):
        _lwe(payload)
    if MODE in ("both", "rlwe", "debug"):
        _rlwe(payload)
    _boundary(payload)

    if MODE == "debug":
        # Explicit opt-in, and only here. Seeing the key is occasionally useful while
        # debugging and never useful while learning what the scheme protects. Both
        # secrets are arguments the graded functions receive anyway, which is why they
        # can travel in the public payload at all.
        print("debug: secrets")
        print(f"  LWE  s = {_tuple(payload['inputs']['lweSecret'])}")
        print(f"  RLWE S = {_tuple(payload['inputs']['rlweSecret'])}")
        print()

    print("Same shape both times: secret-product + encoded message + noise.")
    print("What differs is the product, and how many messages one ciphertext carries.")
    print()
    print("None of this is secure. n, N and q are small enough to enumerate, and the")
    print("secret falls to linear algebra from a handful of samples.")


if __name__ == "__main__":
    main()
