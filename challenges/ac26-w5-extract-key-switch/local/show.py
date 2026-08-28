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

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
try:
    # `or` rather than a default argument: the Makefile always passes -e INDEX, so an
    # unset INDEX arrives as the empty string rather than as an absent variable.
    INDEX = int(os.environ.get("INDEX") or "0")
except ValueError:
    INDEX = 0


def _public_payload() -> dict:
    """This deployment's public half, and every value printed below.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). It has to implement `phase_coefficient`,
    `extract_sample`, `extract_trace`, `decompose_mask`, `key_switch` and `domain_report`
    to derive the numbers below -- every one of the six names `starter/extract.py` asks the
    learner to write -- so leaving it reachable here handed over the whole problem for the
    price of one import. The verifier, which is the only image that still carries
    `fixtures/`, serves the public half over `GET /public`: `PUBLIC_EVIDENCE_JSON` when the
    Portal has already fetched it, `VERIFIER_PUBLIC_URL` when this process must fetch it
    itself.

    The `INDEX` knob travels in the query string, because `make inspect INDEX=...` has
    always been able to ask for any coefficient of the ring, and comparing index 0 against
    the last one is the instruction in this file's opening paragraph.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        parts = urlsplit(verifier_public_url)
        url = urlunsplit(parts._replace(query=urlencode({"index": str(INDEX)})))
        try:
            with urlopen(url, timeout=30) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            # Compose health-gates the workbench on the verifier, so this normally cannot
            # happen. When it does -- a `docker compose run` against a torn-down deployment
            # -- say which service is missing instead of printing a urllib traceback at
            # somebody trying to read their fixtures.
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

    return public_payload(SEED, INDEX)


def main() -> None:
    payload = _public_payload()
    par = payload["params"]
    index = payload["index"]
    extracted = payload["extracted"]
    switched = payload["switched"]

    print("health token :", payload["healthToken"])
    print()
    print(f"  base B            {par['base']}")
    print(f"  levels L          {par['levels']}")
    print(f"  modulus q         {par['modulus']}   = B^L")
    print(f"  ring degree N     {par['degree']}       <- the extracted sample's dimension")
    print(f"  target dimension  {par['targetDimension']}       <- where the switch lands")
    print(f"  plaintext mod     {par['plaintextModulus']}   (delta {par['delta']})")
    print(f"  noise bound       {payload['noise']['bound']}   (budget {payload['noise']['budget']})")
    print()

    print("  The accumulator is a real blind-rotation output, noise and all.")
    print(f"    a  {tuple(payload['accumulator']['a'])}")
    print(f"    b  {tuple(payload['accumulator']['b'])}")
    print()

    print(f"  extracting coefficient {index}:")
    print("    target  source  sign  wrapped  value")
    for record in payload["trace"]:
        print(
            f"    {record['target']:<7} {record['source']:<7} {record['sign']:<+5}"
            f" {str(record['wrapped']):<8} {record['value']}"
        )
    print(f"  The boundary sits at {index}: every slot above it wrapped past the degree,")
    print("  and X^N = -1 is why those come back negated.")
    print()

    mask = tuple(extracted["mask"])
    print(f"    extracted mask  {mask}")
    print(f"    extracted body  {extracted['body']}")
    print(f"    its phase       {extracted['phase']}")
    print(f"    the coefficient {extracted['coefficient']}   <- the same number, exactly")
    print()

    digits = payload["digits"]
    print(f"  decomposing the mask, base {par['base']}, {par['levels']} levels, MSB first:")
    for j, row in enumerate(digits[: min(3, len(digits))]):
        print(f"    coefficient {j}  {mask[j]:<8} -> {tuple(row)}")
    if len(digits) > 3:
        print(f"    ... {len(digits) - 3} more")
    print()

    report = payload["report"]
    print("  switching keys:")
    for field in (
        "sourceKeyId", "targetKeyId", "sourceDimension", "targetDimension",
        "base", "levels", "compatible", "noiseAdded",
    ):
        print(f"    {field:<18} {report[field]}")
    print()
    print(f"    switched mask   {tuple(switched['mask'])}")
    print(f"    switched body   {switched['body']}")
    print(f"    now belongs to  {switched['keyId']}")
    print()

    messages = payload["messages"]
    print("  the same message, three ways:")
    print(f"    RLWE coefficient {index}   {messages['coefficient']}")
    print(f"    extracted, under the ring key   {messages['extracted']}")
    print(f"    switched, under the target key  {messages['switched']}")
    print()
    print("  Neither step decrypted anything. The extraction was handed no key at all, and")
    print("  the switch saw the source secret only inside the switching key's ciphertexts.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
