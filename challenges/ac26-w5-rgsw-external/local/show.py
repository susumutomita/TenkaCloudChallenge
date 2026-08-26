"""`make inspect` — the gadget, one decomposition, the RGSW row layout, and the product.

    make inspect            selector 1 (the message survives)
    make inspect CASE=0     selector 0 (the message becomes zero)

The secret is not printed, and neither is the selector's plaintext outside the header line
that names which case is being shown. Everything else is what an observer of the protocol
would see.
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
    stage any more (see local/Dockerfile). It has to implement `gadget_vector`,
    `decompose`, `recompose`, `decompose_poly`, `recompose_poly`, `levels_needed`,
    `smallest_unrepresentable`, `rgsw_encrypt`, `external_product` and `external_trace`
    to derive the numbers below -- exactly the ten names `starter/rgsw.py` asks the
    learner to write -- so leaving it reachable here handed over the whole problem for the
    price of one import. The verifier, which is the only image that still carries
    `fixtures/`, serves the public half over `GET /public`: `PUBLIC_EVIDENCE_JSON` when
    the Portal has already fetched it, `VERIFIER_PUBLIC_URL` when this process must fetch
    it itself.
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

    Every ring element below was printed as a tuple before the split, and the shape of a
    ring element is part of what the trace is teaching.
    """
    return tuple(values)


def main() -> None:
    payload = _public_payload()
    par = payload["params"]
    selector = 0 if CASE == "0" else 1
    case = payload["cases"][str(selector)]
    base, levels, degree, q = par["base"], par["levels"], par["degree"], par["modulus"]
    gadget = _tuple(payload["gadget"])

    print("health token :", payload["healthToken"])
    print()
    print(f"  base B        {base}")
    print(f"  levels L      {levels}")
    print(f"  modulus q     {q}   = B^L, which is what makes recomposition exact")
    print(f"  ring degree N {degree}")
    print(f"  gadget        {gadget}")
    print(f"  noise bound   {payload['noiseBound']}   (budget {payload['budget']})")
    print()

    decomposition = payload["decomposition"]
    print(f"  decomposing {decomposition['value']}:")
    print(f"    digits (LSB first)  {_tuple(decomposition['digits'])}")
    print(f"    gadget              {gadget}")
    print(f"    inner product       {decomposition['recomposed']}   <- back to {decomposition['value']}")
    print()

    ciphertext = payload["ciphertext"]
    print(f"  message              {_tuple(ciphertext['messages'])}")
    print(f"  ciphertext a         {_tuple(ciphertext['a'])}")
    print(f"  ciphertext b         {_tuple(ciphertext['b'])}")
    print()
    print(f"  decompose(a) gives {levels} ring elements, one per level:")
    for index, level in enumerate(ciphertext["levels"]):
        print(f"    level {index}  x B^{index} = {gadget[index]:<8} {_tuple(level)}")
    print("  Each level is a ring element of N coefficients -- not one coefficient's digits.")
    print()

    print(f"  RGSW has {case['rows']} rows = 2L. Where the gadget term sits:")
    for j in (0, 1, levels - 1, levels, levels + 1, 2 * levels - 1):
        slot = "a" if j < levels else "b"
        power = j if j < levels else j - levels
        print(f"    row {j:<3} gadget[{power}] = {gadget[power]:<8} in the {slot} slot")
    print()

    trace = case["trace"]
    print(f"  external product, selector {selector} (accumulating over {len(trace)} rows):")
    print("    row  slot  level   accumulated_a[0]  accumulated_b[0]")
    for record in trace:
        print(
            f"    {record['row']:<4} {record['slot']:<5} {record['level']:<7}"
            f" {record['accumulated_a'][0]:<17} {record['accumulated_b'][0]}"
        )
    print()
    print(f"  result a             {_tuple(case['product']['a'])}")
    print(f"  result b             {_tuple(case['product']['b'])}")
    print(f"  decrypts to          {_tuple(case['decrypted'])}")
    print(f"  original message     {_tuple(ciphertext['messages'])}")
    print()
    print("  Same arithmetic either way. Nothing in the result says which selector it was.")
    print()

    exhaustion = payload["exhaustion"]
    print(f"  with only {exhaustion['shortLevels']} levels instead of {levels}:")
    print(f"    levels needed for q={q}   {exhaustion['levelsNeeded']}")
    print(f"    smallest value that fails  {exhaustion['witness']}")
    print("    decompose does not complain about it. It just drops what will not fit.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
