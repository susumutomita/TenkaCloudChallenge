"""Prove that final delivery misses most defects and the audit catches them.

Six of the eight mutations below still deliver the chosen message for every case in
the final-output probe. They are nevertheless broken OT implementations: the choice,
one or both messages, or the ciphertext ordering contract is wrong. The measured count
is part of the problem design and fails closed if it changes.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from tests.hidden import check_ot  # noqa: E402

REFERENCE = (ROOT / "reference" / "ot.py").read_text(encoding="utf-8")
SEED = "mutation-suite-seed"

REQUEST_RETURN = (
    "    return receiver_base * pow(sender_public, choice, GROUP_PRIME) % GROUP_PRIME"
)
CIPHERTEXT_RETURN = (
    "    return (message_0 ^ _pad(shared_0, 0), message_1 ^ _pad(shared_1, 1))"
)
DECRYPT_RETURN = "    return ciphertexts[choice] ^ _pad(shared, choice)"

MUTATIONS: tuple[tuple[str, list[tuple[str, str]]], ...] = (
    (
        "puts the choice in the request and sends both messages in clear",
        [
            (REQUEST_RETURN, "    return (choice, receiver_secret)"),
            ("    _require_group_element(request)", "    choice, receiver_secret = request"),
            (
                "    shared_0 = pow(request, sender_secret, GROUP_PRIME)",
                "    shared_0 = 1",
            ),
            (
                "    shared_1 = pow(request * inverse_public % GROUP_PRIME, sender_secret, GROUP_PRIME)",
                "    shared_1 = 1",
            ),
            (CIPHERTEXT_RETURN, "    return (message_0, message_1)"),
            (DECRYPT_RETURN, "    return ciphertexts[choice]"),
        ],
    ),
    (
        "sends both messages in clear while keeping the group transcript",
        [
            (CIPHERTEXT_RETURN, "    return (message_0, message_1)"),
            (DECRYPT_RETURN, "    return ciphertexts[choice]"),
        ],
    ),
    (
        "derives both pads from the public key",
        [
            (
                "    shared_0 = pow(request, sender_secret, GROUP_PRIME)",
                "    shared_0 = sender_public",
            ),
            (
                "    shared_1 = pow(request * inverse_public % GROUP_PRIME, sender_secret, GROUP_PRIME)",
                "    shared_1 = sender_public",
            ),
            (
                "    shared = pow(sender_public, receiver_secret, GROUP_PRIME)",
                "    shared = sender_public",
            ),
        ],
    ),
    (
        "uses the same receiver key for both branches",
        [
            (REQUEST_RETURN, "    return receiver_base"),
            (
                "    shared_1 = pow(request * inverse_public % GROUP_PRIME, sender_secret, GROUP_PRIME)",
                "    shared_1 = shared_0",
            ),
        ],
    ),
    (
        "attaches the choice to an otherwise valid request",
        [
            (REQUEST_RETURN, REQUEST_RETURN.replace("return ", "return (") + ", choice)"),
            ("    _require_group_element(request)", "    request, leaked_choice = request"),
        ],
    ),
    (
        "swaps the ciphertext branches and compensates in decryption",
        [
            (
                CIPHERTEXT_RETURN,
                "    return (message_1 ^ _pad(shared_1, 1), message_0 ^ _pad(shared_0, 0))",
            ),
            (
                DECRYPT_RETURN,
                "    return ciphertexts[1 - choice] ^ _pad(shared, choice)",
            ),
        ],
    ),
    (
        "drops the sender public factor for choice one",
        [(REQUEST_RETURN, "    return receiver_base")],
    ),
    (
        "always opens branch zero",
        [(DECRYPT_RETURN, "    return ciphertexts[0] ^ _pad(shared, 0)")],
    ),
)

FINAL_OUTPUT_BLIND = 6


def _load(source: str):
    module = types.ModuleType("mut_ot")
    exec(compile(source, "<mutation>", "exec"), module.__dict__)  # noqa: S102
    return module


def main() -> int:
    reference = _load(REFERENCE)
    baseline = check_ot.run(reference, SEED)
    if baseline:
        print(f"FAIL reference implementation does not pass: {baseline[0]}")
        return 1
    print("PASS reference implementation passes the hidden checks")

    survivors = 0
    blind = 0
    for name, substitutions in MUTATIONS:
        missing = [needle for needle, _ in substitutions if needle not in REFERENCE]
        if missing:
            print(f"SURVIVED {name} (mutation no longer applies)")
            survivors += 1
            continue
        source = REFERENCE
        for needle, replacement in substitutions:
            source = source.replace(needle, replacement)
        try:
            module = _load(source)
            failures = check_ot.run(module, SEED)
            delivery_only = not check_ot.check_delivery(module, SEED)
        except Exception as error:  # noqa: BLE001
            failures = [f"raised {type(error).__name__}"]
            delivery_only = False
        blind += int(delivery_only)
        if failures:
            marker = " [final-output-blind]" if delivery_only else ""
            print(f"KILLED{marker} {name} ({failures[0]})")
        else:
            print(f"SURVIVED {name}")
            survivors += 1

    from verifier.server import evaluate  # noqa: PLC0415

    inert = "\n".join(
        [
            "def make_receiver_request(sender_public, choice, receiver_secret): return choice",
            "def seal_sender_messages(sender_secret, request, message_0, message_1): return (message_0, message_1)",
            "def open_receiver_message(sender_public, choice, receiver_secret, ciphertexts): return ciphertexts[choice]",
        ]
    )
    if evaluate("message-audit", inert):
        print("SURVIVED verifier credits the cleartext protocol")
        survivors += 1
    else:
        print("KILLED verifier credits the cleartext protocol")

    print(f"FINAL-OUTPUT-BLIND {blind} of {len(MUTATIONS)}")
    if blind != FINAL_OUTPUT_BLIND:
        print(
            f"Expected {FINAL_OUTPUT_BLIND} final-output-blind mutations; "
            "update the tests and documentation together."
        )
        return 1
    if survivors:
        print(f"{survivors} mutation(s) survived.")
        return 1
    print(f"All {len(MUTATIONS) + 1} mutations killed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
