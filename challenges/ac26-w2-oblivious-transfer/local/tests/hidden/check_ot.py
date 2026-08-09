"""Hidden checks separate delivery from the two privacy promises."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import (  # noqa: E402
    GENERATOR,
    GROUP_ORDER,
    GROUP_PRIME,
    case,
    cases,
    ciphertexts_for,
    pad,
    request_for,
)

LABELS = ("h0", "h1", "h2", "h3")


def _attempt(callable_, name: str):
    try:
        return callable_()
    except Exception as error:  # noqa: BLE001
        return f"{name} raised {type(error).__name__}"


def check_request(module, seed: str) -> list[str]:
    failures: list[str] = []
    for label in LABELS:
        for choice in (0, 1):
            item = case(seed, label, choice)
            got = _attempt(
                lambda: module.make_receiver_request(
                    item.sender_public, choice, item.receiver_secret
                ),
                "make_receiver_request",
            )
            if isinstance(got, str):
                return [got]
            if type(got) is not int:
                failures.append("the request is not one group element")
            elif got != request_for(item.sender_public, choice, item.receiver_secret):
                failures.append("the request does not have the declared algebraic form")
    return failures


def check_encrypt(module, seed: str) -> list[str]:
    failures: list[str] = []
    for item in cases(seed, "encrypt"):
        request = request_for(item.sender_public, item.choice, item.receiver_secret)
        got = _attempt(
            lambda: module.seal_sender_messages(
                item.sender_secret, request, item.message_0, item.message_1
            ),
            "seal_sender_messages",
        )
        if isinstance(got, str):
            return [got]
        if not isinstance(got, (tuple, list)) or len(got) != 2:
            failures.append("the sender did not return two ciphertexts")
        elif tuple(got) != ciphertexts_for(item, request):
            failures.append("the ciphertext pair does not match the declared construction")
    return failures


def check_decrypt(module, seed: str) -> list[str]:
    failures: list[str] = []
    for item in cases(seed, "decrypt"):
        ciphertexts = ciphertexts_for(item)
        got = _attempt(
            lambda: module.open_receiver_message(
                item.sender_public, item.choice, item.receiver_secret, ciphertexts
            ),
            "open_receiver_message",
        )
        if isinstance(got, str):
            return [got]
        if got != (item.message_0, item.message_1)[item.choice]:
            failures.append("the receiver did not open the selected branch")
    return failures


def check_delivery(module, seed: str) -> list[str]:
    """The strongest final-output test; still blind to the privacy failures."""
    failures: list[str] = []
    for item in cases(seed, "delivery", 10):
        try:
            request = module.make_receiver_request(
                item.sender_public, item.choice, item.receiver_secret
            )
            ciphertexts = module.seal_sender_messages(
                item.sender_secret, request, item.message_0, item.message_1
            )
            opened = module.open_receiver_message(
                item.sender_public, item.choice, item.receiver_secret, ciphertexts
            )
        except Exception as error:  # noqa: BLE001
            return [f"the end-to-end protocol raised {type(error).__name__}"]
        if opened != (item.message_0, item.message_1)[item.choice]:
            failures.append("the end-to-end protocol delivered the wrong message")
    return failures


def check_choice_privacy(module, seed: str) -> list[str]:
    """Exhaust the toy subgroup: both choices must yield the same multiset."""
    item = case(seed, "choice-audit", 0)
    observed: list[Counter[int]] = []
    for choice in (0, 1):
        values: list[int] = []
        for secret in range(GROUP_ORDER):
            try:
                request = module.make_receiver_request(
                    item.sender_public, choice, secret
                )
            except Exception as error:  # noqa: BLE001
                return [f"choice audit raised {type(error).__name__}"]
            if type(request) is not int:
                return ["a request carries more than one group element"]
            if not 1 <= request < GROUP_PRIME or pow(request, GROUP_ORDER, GROUP_PRIME) != 1:
                return ["a request left the declared subgroup"]
            values.append(request)
        observed.append(Counter(values))
    if observed[0] != observed[1]:
        return ["the request distribution reveals which choice was made"]
    if len(observed[0]) != GROUP_ORDER:
        return ["the request does not cover the subgroup uniformly"]
    return []


def check_message_privacy(module, seed: str) -> list[str]:
    """Catch plaintext, public-key pads, and a receiver key that opens both branches."""
    failures: list[str] = []
    for item in cases(seed, "message-audit", 8):
        request = request_for(item.sender_public, item.choice, item.receiver_secret)
        try:
            ciphertexts = tuple(
                module.seal_sender_messages(
                    item.sender_secret, request, item.message_0, item.message_1
                )
            )
        except Exception as error:  # noqa: BLE001
            return [f"message audit raised {type(error).__name__}"]
        if len(ciphertexts) != 2:
            return ["the transcript does not contain exactly two ciphertexts"]
        messages = (item.message_0, item.message_1)
        if ciphertexts == messages or any(c == m for c, m in zip(ciphertexts, messages)):
            failures.append("a sender message appears unchanged in the transcript")

        changed_0 = tuple(
            module.seal_sender_messages(
                item.sender_secret, request, item.message_0 ^ 1, item.message_1
            )
        )
        changed_1 = tuple(
            module.seal_sender_messages(
                item.sender_secret, request, item.message_0, item.message_1 ^ 1
            )
        )
        if changed_0[0] == ciphertexts[0] or changed_0[1] != ciphertexts[1]:
            failures.append("changing message 0 did not change only ciphertext 0")
        if changed_1[1] == ciphertexts[1] or changed_1[0] != ciphertexts[0]:
            failures.append("changing message 1 did not change only ciphertext 1")

        publicly_guessed = tuple(
            ciphertexts[index] ^ pad(item.sender_public, index) for index in (0, 1)
        )
        if publicly_guessed == messages:
            failures.append("both messages can be opened from the sender public key")

        shared = pow(item.sender_public, item.receiver_secret, GROUP_PRIME)
        other = 1 - item.choice
        guessed_other = ciphertexts[other] ^ pad(shared, other)
        if guessed_other == messages[other]:
            failures.append("the receiver's one shared key opens the unchosen message too")
    return failures


def run(module, seed: str) -> list[str]:
    return [
        *check_request(module, seed),
        *check_encrypt(module, seed),
        *check_decrypt(module, seed),
        *check_delivery(module, seed),
        *check_choice_privacy(module, seed),
        *check_message_privacy(module, seed),
    ]
