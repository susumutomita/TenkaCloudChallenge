"""`make inspect` — show your fixtures and the intermediate values you need.

Everything here is derived from FLAG_SEED, so what you see is yours: copying another
learner's numbers will not help you.

The one thing this deliberately does not print is a padded message. Seeing the answer
laid out byte by byte would turn the `pad` checkpoint into transcription.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _public_evidence() -> dict[str, object]:
    """This deployment's public evidence.

    Issue 543/537: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). Alongside the fixtures it also defines
    `padded_length` and `broken_pad_zeros_only` -- the answers to two graded
    checkpoints, as plain functions -- so keeping the module reachable here handed them
    over no matter where the comparison itself lived. `make inspect` now runs through
    Compose (see the Makefile) so this process can reach the verifier, which is the only
    place `fixtures/` still lives, over the network instead.
    """
    injected = os.environ.get("PUBLIC_EVIDENCE_JSON")
    if injected:
        return json.loads(injected)
    verifier_public_url = os.environ.get("VERIFIER_PUBLIC_URL")
    if verifier_public_url:
        try:
            with urlopen(verifier_public_url, timeout=10) as response:  # noqa: S310
                return json.loads(response.read().decode("utf-8"))
        except (OSError, ValueError) as error:
            # Compose declares the verifier a health-gated dependency of the Workbench,
            # so this is not a state `make inspect` reaches on its own. Say which
            # process is missing rather than printing a urllib traceback at somebody
            # whose fixtures live in it.
            raise SystemExit(
                f"could not reach the verifier at {verifier_public_url} ({type(error).__name__}). "
                "Your fixtures live there: start it with `make verifier-up`."
            ) from error
    # Resolves only against a checkout with fixtures/ still on disk (never true inside
    # a built participant image -- see the docstring above).
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _hex_rows(data: bytes, per_row: int = 16) -> list[str]:
    rows = []
    for offset in range(0, len(data), per_row):
        chunk = data[offset : offset + per_row]
        rows.append(f"  {offset:04d}  " + " ".join(f"{byte:02x}" for byte in chunk))
    return rows


def main() -> None:
    evidence = _public_evidence()
    block_bytes = evidence["blockBytes"]
    print(f"python        {sys.version.split()[0]}")
    print(f"health token  {evidence['healthToken']}")
    print()

    print("== checkpoint: byte-length ==")
    print(f"  string        {evidence['text']}")
    print(f"  characters    {evidence['charLength']}")
    print("  UTF-8 bytes:")
    for row in _hex_rows(str(evidence["text"]).encode("utf-8")):
        print(row)
    print("  Submit how many BYTES this string is. SHA-256 never sees characters.")
    print()

    print("== checkpoint: padded-length ==")
    print("  For each message length below, how long is the padded message?")
    print(f"  lengths       {', '.join(str(length) for length in evidence['lengthQuiz'])}")
    print("  Submit the six padded lengths in this order, comma separated.")
    print(f"  (Reminder: a block is {block_bytes} bytes, and the padding is never empty.)")
    print()

    print("== checkpoint: length-field ==")
    print(f"  message length  {evidence['lengthFieldCase']} bytes")
    print("  Submit the LAST 8 bytes of that message's padding, as 16 hex characters.")
    print("  Two traps live in this one: the field counts bits, and it is big-endian.")
    print()

    print("== checkpoint: words ==")
    print("  This is one 64-byte block. Read it as sixteen 32-bit words in `block_words`.")
    for row in _hex_rows(bytes.fromhex(str(evidence["wordBlockHex"]))):
        print(row)
    print()

    print("== checkpoint: collision ==")
    original = bytes.fromhex(str(evidence["collisionMessageHex"]))
    print("  Suppose padding just appended zero bytes up to the next multiple of")
    print(f"  {block_bytes} — no 0x80 marker at all. Find a DIFFERENT message that such a")
    print("  scheme cannot tell apart from this one, and submit it as hex.")
    for row in _hex_rows(original):
        print(row)
    print()

    print("== checkpoint: pad ==")
    print("  No fixture to read here. `make test` runs the public tests against your")
    print("  `pad_message`; the checkpoint runs a wider set you cannot see.")


if __name__ == "__main__":
    main()
