"""`make inspect` — the setting you build for, and the two worlds privacy is measured across.

Everything here is derived from FLAG_SEED, so what you see is yours. The hidden tests use
more parties and other fields, and they enumerate the whole probability space of the tiny
setting rather than sampling it.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from participant.lab import (
    honest_sum,
    randomness_space,
    sample_randomness,
    setting_from_payload,
    tiny_settings,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def public_evidence() -> dict:
    """This deployment's public half -- the same values `verifier/server.py`'s `GET /public`
    serves, and the same ones this file has always printed.

    Issue 537/538 (Issue 543 option B2): `fixtures/generate.py` does not ship in the
    `participant` Docker stage any more (see local/Dockerfile). It carries `hidden_settings` --
    the six settings every checkpoint is graded on -- and it shipped beside
    `tests/hidden/check_capstone.py`, which states what each of the eight checkpoints is graded
    on. `make inspect` now runs through Compose (see the Makefile) so this process can reach
    the verifier over the network instead.
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
            # happen. When it does -- a `docker compose run` against a torn-down deployment
            # -- say which service is missing instead of printing a urllib traceback at
            # somebody trying to read their setting.
            raise SystemExit(
                "cannot reach this deployment's verifier "
                f"({verifier_public_url}): {type(error).__name__}.\n"
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a checkout,
    # or the verifier/author Docker stage -- and never inside a built `participant` image, so
    # this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def main() -> None:
    payload = public_evidence()
    setting = setting_from_payload(payload["setting"])
    vocabulary = payload["vocabulary"]

    print("== your setting ==")
    print(f"  parties            {setting.parties}")
    print(f"  field              F_{setting.modulus}")
    print(f"  inputs             {list(setting.inputs)}")
    print(f"  the sum they want  {honest_sum(setting)}")
    print()
    print("  randomness contract")
    print(f"    length           {setting.randomness_length}  (parties x (parties - 1))")
    for party in range(setting.parties):
        low, high = setting.slice_for(party)
        print(f"    party {party} draws   randomness[{low}:{high}]")
    print(f"  one sample         {list(sample_randomness(SEED, setting))}")
    print()

    print("== the vocabulary ==")
    print(f"  claimable          {', '.join(vocabulary['claimable'])}")
    print(f"  this build gives   {', '.join(vocabulary['provided'])}")
    print(f"  and does not give  {', '.join(vocabulary['notProvided'])}")
    print("  Work out for yourself why the second pair is missing before you write `scope`.")
    print()

    left, right = tiny_settings()
    space = len(list(randomness_space(left)))
    print("== how privacy is measured ==")
    print("  Two settings, the same sum, different honest inputs:")
    print(f"    A  inputs={list(left.inputs)}   sum={honest_sum(left)}  over F_{left.modulus}")
    print(f"    B  inputs={list(right.inputs)}   sum={honest_sum(right)}  over F_{right.modulus}")
    print()
    print(f"  Every randomness is enumerated: {space} of them, per setting, per coalition.")
    print("  That is the entire probability space, not a sample. If a coalition below the")
    print("  threshold sees a different distribution in A than in B, it has learned")
    print("  something the output alone does not tell it.")
    print()
    print("  Sweep every coalition. A protocol can be perfectly private against party 0")
    print("  and hand party 2 everything -- and a check that only ever asks party 0 will")
    print("  report that protocol as private.")


if __name__ == "__main__":
    main()
