"""`make inspect` — show your fixtures and the two quizzes.

Everything here is derived from FLAG_SEED, so what you see is yours: copying another
learner's numbers will not help you, and the quiz ORDER is yours too, so an answer string
from someone else's deployment is wrong even if their reasoning was right.

What this deliberately does not print: any state after a round, any digest, and the
avalanche distance. Those are the answers.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

from given.primitives import INITIAL_STATE, K

SEED = os.environ.get("FLAG_SEED", "local-dev-seed")

STATE_NAMES = "abcdefgh"


def _public_evidence() -> dict[str, object]:
    """This deployment's public evidence.

    Issue 543/537: `fixtures/generate.py` does not ship in the `participant` Docker
    stage any more (see local/Dockerfile). Alongside the fixtures it also defines
    `avalanche_distance` and ships `PROPERTY_STATEMENTS` / `STORAGE_STATEMENTS` with
    every statement's correct verdict in plaintext, so keeping the module reachable here
    handed them over no matter where the comparison itself lived. `make inspect` now
    runs through Compose (see the Makefile) so this process can reach the verifier,
    which is the only place `fixtures/` still lives, over the network instead.
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
    # Resolves only against a checkout with fixtures/ still on disk (never true inside a
    # built participant image -- see the docstring above).
    from fixtures.generate import public_payload

    return public_payload(SEED)


def _state(label: str, state: tuple[int, ...]) -> None:
    print(f"  {label}")
    for name, word in zip(STATE_NAMES, state):
        print(f"    {name}  {word:08x}")


def _flipped(message: bytes, bit: int) -> bytes:
    """One bit of `message` flipped. A one-line XOR, not a secret -- computed locally
    rather than fetched, unlike the avalanche DISTANCE, which is the checkpoint answer."""
    data = bytearray(message)
    data[bit // 8] ^= 1 << (bit % 8)
    return bytes(data)


def main() -> None:
    evidence = _public_evidence()
    print(f"python        {sys.version.split()[0]}")
    print(f"health token  {evidence['healthToken']}")
    print()

    print("== given to you, already correct ==")
    print("  local/given/primitives.py has padding, big-endian words, the four sigmas,")
    print("  Ch, Maj and the message schedule. Do not edit it. Its constant tables are")
    print("  derived from prime roots rather than pasted, so you can see where they")
    print("  come from:")
    print(f"    K[0]   {K[0]:08x}   fractional bits of the cube root of 2")
    print(f"    K[63]  {K[63]:08x}   cube root of the 64th prime")
    print(f"    H[0]   {INITIAL_STATE[0]:08x}   square root of 2")
    print()

    round_ = evidence["round"]
    print("== checkpoint: round ==")
    _state("input state:", tuple(round_["state"]))
    print(f"    round index   {round_['roundIndex']}")
    print(f"    K[{round_['roundIndex']}]           {K[round_['roundIndex']]:08x}")
    print(f"    schedule word {round_['scheduleWord']:08x}")
    print("  Implement `round_step`. Only two of the eight words are computed.")
    print()

    feedforward = evidence["feedforward"]
    print("== checkpoint: feedforward ==")
    _state("a state to run forwards and then backwards:", tuple(feedforward["state"]))
    schedule = feedforward["schedule"]
    print(f"    schedule[0]  {schedule[0]:08x}    schedule[63] {schedule[63]:08x}")
    print("  Implement `invert_round` and `invert_rounds`. The 64 rounds throw nothing")
    print("  away, so they can be undone. Then look at what the feed-forward addition")
    print("  in `compress_block` does to that.")
    print()

    avalanche = evidence["avalanche"]
    message = bytes.fromhex(avalanche["messageHex"])
    print("== checkpoint: avalanche ==")
    print(f"  message  {message.hex()}")
    print(f"  flip bit {avalanche['bit']} of it (bit 0 is the least significant bit of byte 0):")
    print(f"           {_flipped(message, avalanche['bit']).hex()}")
    print("  Hash both. Submit how many of the 256 digest bits differ.")
    print()

    print("== checkpoint: properties ==")
    print("  True or false, in this order. Submit one letter each, e.g. TFTF...")
    for index, statement in enumerate(evidence["propertyStatements"], start=1):
        print(f"  {index:>2}. {statement['text']}")
        print(f"      {statement['textJa']}")
    print()

    print("== checkpoint: storage ==")
    print("  You are storing user passwords. True or false, in this order.")
    for index, statement in enumerate(evidence["storageStatements"], start=1):
        print(f"  {index:>2}. {statement['text']}")
        print(f"      {statement['textJa']}")
    print()

    print("== checkpoints: compress / digest ==")
    print("  No fixture to read. `make test` runs the public tests against your")
    print("  `local/starter/compress.py`; each checkpoint runs a wider hidden set.")
    print("  compress -> compress_rounds, compress_block")
    print("  digest   -> sha256_hex")


if __name__ == "__main__":
    main()
