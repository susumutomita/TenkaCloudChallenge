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

from fixtures.generate import group, keypair, session
from tests.hidden.check_oblivious import check_and_gate, run

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
    (
        "blind omits the subgroup's last exponent",
        REFERENCE.replace(
            "    return (0, grp[\"q\"] - 1)",
            "    return (0, grp[\"q\"] - 2)",
        ),
    ),
    (
        "blind includes a duplicate cycle endpoint",
        REFERENCE.replace(
            "    return (0, grp[\"q\"] - 1)",
            "    return (0, grp[\"q\"])",
        ),
    ),
    (
        "party zero's gate mask is fixed and leaks its peer to party one",
        REFERENCE.replace(
            "    return (randomness[0], randomness[1])",
            "    return (0, randomness[1])",
        ),
    ),
    (
        "party one's gate mask is fixed and leaks its peer to party zero",
        REFERENCE.replace(
            "    return (randomness[0], randomness[1])",
            "    return (randomness[0], 0)",
        ),
    ),
    (
        "claims every gate is local",
        REFERENCE.replace("    return gate == \"and\"", "    return False"),
    ),
]


def _load(source: str) -> types.ModuleType:
    module = types.ModuleType("mut_oblivious")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102 - our own fixtures
    return module


def _final_output_failures(module: types.ModuleType) -> list[str]:
    """Check only reconstructed outputs, deliberately ignoring privacy and protocol shape."""
    failures: list[str] = []
    for label in ("final-0", "final-1"):
        grp = group(SEED, label)
        key = keypair(SEED, label)
        ses = session(SEED, label)
        for choice in (0, 1):
            try:
                req = module.request(grp, key["public"], choice, ses["blind"])
                ciphertexts = module.encrypt(
                    grp,
                    key["secret"],
                    key["public"],
                    req,
                    ses["message_0"],
                    ses["message_1"],
                )
                got = module.unwrap(grp, key["public"], choice, ses["blind"], ciphertexts)
            except Exception as error:  # noqa: BLE001
                return [f"transfer raised {type(error).__name__}"]
            wanted = ses["message_0"] if choice == 0 else ses["message_1"]
            if got != wanted:
                failures.append(f"message {choice} did not reconstruct")
    failures.extend(check_and_gate(module, SEED))
    return failures


def main() -> int:
    if run(_load(REFERENCE), SEED):
        print("FAIL reference implementation does not pass the hidden tests")
        return 1
    print("PASS reference implementation passes the hidden tests")

    survivors: list[str] = []
    final_output_blind = 0
    for name, source in MUTATIONS:
        module = _load(source)
        failures = run(module, SEED)
        if not _final_output_failures(module):
            final_output_blind += 1
            prefix = "[final-output-blind] "
        else:
            prefix = ""
        if failures:
            print(f"KILLED {prefix}{name} ({failures[0]})")
        else:
            survivors.append(name)
            print(f"SURVIVED {prefix}{name}")

    from verifier.server import evaluate  # noqa: PLC0415 - imported after sys.path

    if evaluate("and-gate", "def offer(b, m):\n    return (m, m)\n"):
        survivors.append("verifier accepts a gate whose offer ignores the party's bit")
        print("SURVIVED verifier accepts a gate whose offer ignores the party's bit")
    else:
        print("KILLED verifier accepts a gate whose offer ignores the party's bit")

    print(f"FINAL-OUTPUT-BLIND {final_output_blind} of {len(MUTATIONS)}")
    if final_output_blind * 2 <= len(MUTATIONS):
        survivors.append("a majority of mutations must survive final-output-only checks")

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
