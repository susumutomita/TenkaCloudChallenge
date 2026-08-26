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

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
# `or` rather than a default argument: the Makefile always passes -e CASE, so an
# unset CASE arrives as the empty string rather than as an absent variable.
CASE = (os.environ.get("CASE") or "1").strip()


def _public_payload() -> dict:
    """This deployment's public half, and every value printed below.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). It has to implement `rlwe_add`, `rlwe_sub`,
    `cmux`, `monomial_rotate`, `rotate_ciphertext`, `conditional_rotate`, `blind_rotate`
    and `blind_rotate_trace` -- exactly the eight names `starter/cmux.py` asks the learner
    to write -- to produce the rotation table, the CMUX rows and the trace below, so
    leaving it reachable here handed over the whole problem for the price of one import.
    The verifier, which is the only image that still carries `fixtures/`, serves the public
    half over `GET /public`: `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it,
    `VERIFIER_PUBLIC_URL` when this process must fetch it itself.
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
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down
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
    """The payload arrives as JSON, so every tuple came back as a list."""
    return tuple(values)


def main() -> None:
    public = _public_payload()
    par = public["params"]
    degree, q = par["degree"], par["modulus"]
    case = public["cases"].get(CASE) or public["cases"]["1"]

    print("health token :", public["healthToken"])
    print()
    print(f"  base B          {par['base']}")
    print(f"  levels L        {par['levels']}")
    print(f"  modulus q       {q}   = B^L")
    print(f"  ring degree N   {degree}")
    print(f"  LWE dimension   {par['dimension']}")
    print(f"  plaintext mod   {par['plaintext_modulus']}   (delta {par['delta']})")
    print(f"  noise bound     {public['noiseBound']}   (budget {public['budget']})")
    print()

    table = public["rotationTable"]
    print("  X^(2N) = 1 and X^N = -1, so an exponent is normalized modulo 2N and one wrap")
    print("  flips the sign. Rotating (1, 0, ...) through a full turn:")
    for step in table["steps"]:
        print(f"    X^{step['exponent']:<3} * (1, 0, ...) = {_tuple(step['result'])}")
    print(f"    X^-1 is X^{table['inverse']['exponent']}: {_tuple(table['inverse']['result'])}")
    print()

    demo = public["branchDemo"]
    print(f"  branch 0 carries {_tuple(demo['m0'])}")
    print(f"  branch 1 carries {_tuple(demo['m1'])}")
    print("    selector  output digest   decrypts to   equals ct0 / ct1?")
    for row in demo["rows"]:
        print(
            f"    {row['selector']:<9} {row['digest']:<15} {_tuple(row['decrypts'])}"
            f"   {'yes' if row['equalsACandidate'] else 'no'}"
        )
    print("  Neither one. The external product adds fresh noise on both paths, so the")
    print("  output is a new ciphertext either way -- which is what stops the result")
    print("  from saying which branch was taken.")
    print()

    sample = case["sample"]
    print(f"  accumulator plaintext  {_tuple(public['accumulator']['plaintext'])}")
    print(f"  LWE mask               {_tuple(sample['mask'])}   over Z_{sample['modulus']}")
    print(f"  LWE body               {sample['body']}   (public)")
    print()
    print("  blind rotation, step by step:")
    print("    step  coefficient  exponent  selector       candidate0    candidate1    output")
    for record in case["trace"]:
        print(
            f"    {record['step']:<5} {record['mask']:<12} {record['exponent']:<9}"
            f" {record['selector']:<14} {record['candidate0']}  {record['candidate1']}"
            f"  {record['output']}"
        )
    print("  Step 0 is the public offset: `body` is not a secret, so there is no encrypted")
    print("  choice and both candidates are the same ciphertext. Every later step is a real")
    print("  CMUX, and its output matches neither candidate.")
    print()

    print(f"  decrypts to            {_tuple(case['decrypts'])}")
    print(f"  plaintext model        {_tuple(case['model'])}")
    print(f"  phase (author's view)  {case['phase']}")
    print(f"  X^(-phase) * accumulator decodes to {_tuple(case['rotatedDecodes'])}")
    print()
    print("  Nothing in the loop computed that phase. It cannot: the secret is only ever")
    print("  present as 2L rows of ciphertext per bit.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
