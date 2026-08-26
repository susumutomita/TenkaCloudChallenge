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

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
# `or` rather than a default argument: the Makefile always passes -e F and -e M, so an
# unset knob arrives as the empty string rather than as an absent variable.
FUNCTION = (os.environ.get("F") or "identity").strip()
try:
    MESSAGE = 1 if int((os.environ.get("M") or "1").strip()) else 0
except ValueError:
    MESSAGE = 1


def _public_payload() -> dict:
    """This deployment's public half, and every value printed below.

    Issue 543 option B2: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). It has to implement `lookup_accumulator`,
    `to_rotation_domain`, `blind_rotate`, `output_noise_bound`, `correctness_bound`,
    `refresh_report` and `nand_combine` to derive the numbers below -- seven of the twelve
    names `starter/pipeline.py` asks the learner to write -- so leaving it reachable here
    handed over most of the problem for the price of one import. The verifier, which is the
    only image that still carries `fixtures/`, serves the public half over `GET /public`:
    `PUBLIC_EVIDENCE_JSON` when the Portal has already fetched it, `VERIFIER_PUBLIC_URL`
    when this process must fetch it itself.

    The `f` and `m` knobs travel in the query string, because unlike the other problems in
    this class the demonstration has eight variants rather than one, and which variant a
    learner is looking at is the whole point of the `F=always-one` instruction above.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        from urllib.error import HTTPError, URLError
        from urllib.request import urlopen

        parts = urlsplit(verifier_public_url)
        url = urlunsplit(
            parts._replace(query=urlencode({"f": FUNCTION, "m": str(MESSAGE)}))
        )
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

    return public_payload(SEED, FUNCTION, MESSAGE)


def main() -> None:
    payload = _public_payload()
    par = payload["params"]
    name = payload["function"]
    message = payload["message"]
    table = payload["table"]
    noise = payload["noise"]

    print("health token :", payload["healthToken"])
    print()
    print(f"  parameter set     {par['parameterSetId']}")
    print(f"  base B            {par['base']}")
    print(f"  levels L          {par['levels']}")
    print(f"  modulus q         {par['modulus']}   = B^L")
    print(f"  ring degree N     {par['degree']}       <- rotation domain is Z_{2 * par['degree']}")
    print(f"  LWE dimension n   {par['dimension']}")
    print(f"  encoding          {par['encodingId']}   encode(1) = +q/8 = {par['delta']}, encode(0) = -q/8")
    print()
    print(f"  blind rotation adds at most  {noise['blindRotation']}")
    print(f"  key switch adds at most      {noise['keySwitch']}")
    print(f"  so a bootstrapped ciphertext {noise['output']}")
    print(f"  and one tolerates            {noise['correctness']}   <- the correctness bound")
    print()

    print(f"  f = {name}, m = {message}, so f(m) = {payload['applied']}")
    print(f"  the lookup table is {{0: {table['0']}, 1: {table['1']}}}")
    print()

    rows = payload["rows"]
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

    before, after = payload["before"], payload["after"]
    print("  before and after:")
    print(f"    input phase   {before['phase']:>8}  -> decodes {before['decodes']}")
    print(f"    output phase  {after['phase']:>8}  -> decodes {after['decodes']}   (f(m) = {payload['applied']})")
    print(f"    output key    {after['keyId'][:8]}  <- the same key the input came under")
    print(f"    last digest   {after['lastDigest']}")
    print()

    report = payload["refreshReport"]
    print("  the refresh, as numbers:")
    for field in ("inputNoise", "correctnessBound", "outputNoiseBound", "withinContract", "secondPassFits"):
        print(f"    {field:<18} {report[field]}")
    print("  outputNoiseBound does not mention inputNoise. Change one and the other does not move.")
    print()

    print("  HomNAND, all four rows:")
    for gate in payload["gate"]:
        combined = gate["combinedPhase"]
        print(
            f"    NAND({gate['left']},{gate['right']}) = {gate['value']}"
            f"   combined phase {combined:>8}  ({'+' if combined > 0 else '-'})"
        )
    print()
    print("  The sign of that phase is the gate. One linear combination, then one bootstrap")
    print("  with the identity table -- there is no plaintext NAND anywhere in it.")
    print()
    print("None of this is secure. The parameters are small enough to enumerate.")


if __name__ == "__main__":
    main()
