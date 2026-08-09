"""Mutation suite: break the reference on purpose, assert the hidden tests notice.

Two of these are the reason the problem exists. `blind excludes 0` and `one mask
reused for both transfers` are both *correct* -- every message arrives, every gate
reconstructs -- and both hand a secret to the other side. If either survives, the
problem is teaching that a passing test means a private protocol, which is worse
than teaching nothing.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tests.hidden.check_oblivious import run

SEED = "mutation-suite-seed"
REFERENCE = (Path(__file__).resolve().parent / "reference" / "oblivious.py").read_text("utf-8")

_OFFER_BODY = "    return (mask, mask ^ own_bit)"
_SHARE_BODY = "    return (own_x & own_y) ^ own_mask ^ received"

MUTATIONS: list[tuple[str, str]] = [
    (
        "blind excludes 0, so two requests name the choice bit",
        REFERENCE.replace("    return (0, grp[\"q\"] - 1)", "    return (1, grp[\"q\"] - 1)"),
    ),
    (
        "one mask reused for both transfers: correct, and leaks the other party's bit",
        REFERENCE.replace(
            "    return (randomness[0], randomness[1])",
            "    return (randomness[0], randomness[0])",
        ),
    ),
    (
        "request ignores the choice, so the receiver always gets message 0",
        REFERENCE.replace(
            "    return (public * blinded) % p if choice else blinded",
            "    return blinded",
        ),
    ),
    (
        "sender derives both keys from the request as sent",
        REFERENCE.replace(
            "    unshifted = (req * pow(public, p - 2, p)) % p",
            "    unshifted = req",
        ),
    ),
    (
        "receiver decrypts with its own blind as the key material",
        REFERENCE.replace(
            "    key = derive_key(grp, pow(public, blind, grp[\"p\"]))",
            "    key = derive_key(grp, blind)",
        ),
    ),
    (
        "offer folds the mask into only one branch",
        REFERENCE.replace(_OFFER_BODY, "    return (0, mask ^ own_bit)"),
    ),
    (
        "output share drops the mask it kept as sender",
        REFERENCE.replace(_SHARE_BODY, "    return (own_x & own_y) ^ received"),
    ),
    (
        "claims XOR also needs a transfer",
        REFERENCE.replace("    return gate == \"and\"", "    return True"),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_oblivious")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def main() -> int:
    if run(_load(REFERENCE), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    for name, source in MUTATIONS:
        failures = run(_load(source), SEED)
        if failures:
            print(f"KILLED {name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("and-gate", "def offer(b, m):\n    return (m, m)\n"):
        survivors.append("verifier accepts a gate whose offer ignores the party's bit")
        print("SURVIVED verifier accepts a gate whose offer ignores the party's bit")
    else:
        print("KILLED verifier accepts a gate whose offer ignores the party's bit")

    print()
    if survivors:
        print(f"{len(survivors)} mutation(s) survived:")
        for name in survivors:
            print(f"  - {name}")
        return 1
    print(f"All {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
