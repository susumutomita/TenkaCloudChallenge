"""`make inspect` — show your fixtures and the intermediate values you need.

Everything here is derived from FLAG_SEED, so what you see is yours: copying another
learner's numbers will not help you.

The one thing this deliberately does not print is a padded message. Seeing the answer
laid out byte by byte would turn the `pad` checkpoint into transcription.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixtures.generate import (
    BLOCK_BYTES,
    collision_message,
    health_token,
    length_field_case,
    length_quiz,
    text_case,
    word_case,
)

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")


def _hex_rows(data: bytes, per_row: int = 16) -> list[str]:
    rows = []
    for offset in range(0, len(data), per_row):
        chunk = data[offset : offset + per_row]
        rows.append(f"  {offset:04d}  " + " ".join(f"{byte:02x}" for byte in chunk))
    return rows


def main() -> None:
    case = text_case(SEED)
    print(f"python        {sys.version.split()[0]}")
    print(f"health token  {health_token(SEED)}")
    print()

    print("== checkpoint: byte-length ==")
    print(f"  string        {case.text}")
    print(f"  characters    {case.char_length}")
    print("  UTF-8 bytes:")
    for row in _hex_rows(case.text.encode("utf-8")):
        print(row)
    print("  Submit how many BYTES this string is. SHA-256 never sees characters.")
    print()

    print("== checkpoint: padded-length ==")
    print("  For each message length below, how long is the padded message?")
    print(f"  lengths       {', '.join(str(length) for length in length_quiz(SEED))}")
    print("  Submit the six padded lengths in this order, comma separated.")
    print(f"  (Reminder: a block is {BLOCK_BYTES} bytes, and the padding is never empty.)")
    print()

    print("== checkpoint: length-field ==")
    print(f"  message length  {length_field_case(SEED)} bytes")
    print("  Submit the LAST 8 bytes of that message's padding, as 16 hex characters.")
    print("  Two traps live in this one: the field counts bits, and it is big-endian.")
    print()

    print("== checkpoint: words ==")
    print("  This is one 64-byte block. Read it as sixteen 32-bit words in `block_words`.")
    for row in _hex_rows(word_case(SEED)):
        print(row)
    print()

    print("== checkpoint: collision ==")
    original = collision_message(SEED)
    print("  Suppose padding just appended zero bytes up to the next multiple of")
    print(f"  {BLOCK_BYTES} — no 0x80 marker at all. Find a DIFFERENT message that such a")
    print("  scheme cannot tell apart from this one, and submit it as hex.")
    for row in _hex_rows(original):
        print(row)
    print()

    print("== checkpoint: pad ==")
    print("  No fixture to read here. `make test` runs the public tests against your")
    print("  `pad_message`; the checkpoint runs a wider set you cannot see.")


if __name__ == "__main__":
    main()
