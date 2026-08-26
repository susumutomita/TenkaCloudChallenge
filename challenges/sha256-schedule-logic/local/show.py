"""`make inspect` — show your fixtures, in hex and in bits.

Everything here is derived from FLAG_SEED, so what you see is yours: copying another
learner's numbers will not help you.

The bit rows exist because these checkpoints are about bit positions, and reading a
rotation out of two hex strings is much harder than reading it out of two bit rows.
What this deliberately does not print is any expanded schedule, or the result of any
sigma: those are the answers.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")
WORD_BITS = 32


def _public_payload() -> dict[str, object]:
    """This deployment's public evidence -- the rotate, mux and dependency cases and
    the health token, the same things `verifier/server.py`'s `GET /public` serves.

    Issue 537/538: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). Keeping it reachable here, even with every
    checkpoint's own comparison staying in `verifier/server.py`, still handed a learner
    the derivation functions the checkpoints exercise -- `rotate_case`/`mux_case` are
    `rotate`/`mux`'s expected values directly, and `dependency_case` is
    `first_affected_index`'s only input. `make inspect` now runs through Compose (see
    the Makefile) so this process can reach the verifier over the network instead.
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
                "The public evidence lives there since Issue 537/538. "
                "Start it with `make verifier-up` and try again."
            ) from error
    # Neither is set: this resolves only where `fixtures/` is actually on disk -- a
    # checkout, or the verifier/author Docker stage -- and never inside a built
    # `participant` image, so this branch does not reopen the leak above.
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _bits(word: int) -> str:
    """32 bits, grouped in fours, so a position can be counted rather than guessed."""
    raw = f"{word:032b}"
    return " ".join(raw[offset : offset + 4] for offset in range(0, WORD_BITS, 4))


def _row(label: str, word: int) -> str:
    return f"  {label:<10} {word:08x}   {_bits(word)}"


def main() -> None:
    payload = _public_payload()
    print(f"python        {sys.version.split()[0]}")
    print(f"health token  {payload['healthToken']}")
    print()

    rotate = payload["rotate"]
    print("== checkpoint: rotate ==")
    print(_row("word", rotate["word"]))
    print(f"  Rotate it right by {rotate['rotateBy']}, then shift it right by {rotate['shiftBy']}.")
    print("  Submit both results as 8 hex characters each, rotation first, comma separated.")
    print("  A rotation keeps every bit. A shift does not. Count the set bits if unsure.")
    print()

    mux = payload["mux"]
    print("== checkpoint: mux ==")
    print(_row("e (select)", mux["e"]))
    print(_row("f", mux["f"]))
    print(_row("g", mux["g"]))
    print("  Submit Ch(e, f, g) as 8 hex characters.")
    print("  f and g are exact complements here, so every bit position is decided by e.")
    print()

    dependency = payload["dependency"]
    words = dependency["words"]
    print("== checkpoint: dependency ==")
    print(f"  These are W[0] through W[{len(words) - 1}] of one block:")
    for index, word in enumerate(words):
        print(_row(f"W[{index}]", word))
    print(f"  Flip bit {dependency['bit']} of W[{dependency['index']}] (bit 0 is the least significant).")
    print("  Submit the index of the FIRST word in the 64-word schedule that changes.")
    print("  You can work this out from the recurrence without expanding anything.")
    print()

    print("== checkpoints: sigma / logic / schedule ==")
    print("  No fixture to read. `make test` runs the public tests against your")
    print("  `local/starter/schedule.py`; each checkpoint runs a wider hidden set.")
    print("  sigma    -> rotr, small_sigma0, small_sigma1, big_sigma0, big_sigma1")
    print("  logic    -> choose, majority")
    print("  schedule -> expand_schedule")


if __name__ == "__main__":
    main()
