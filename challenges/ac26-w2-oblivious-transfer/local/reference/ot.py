"""Reference implementation. Added only to the author image."""

from __future__ import annotations

import hashlib

GROUP_PRIME = 467
GROUP_ORDER = 233
GENERATOR = 4
MESSAGE_MAX = (1 << 16) - 1


def _require_choice(choice: int) -> None:
    if type(choice) is not int or choice not in (0, 1):
        raise ValueError("choice must be 0 or 1")


def _require_exponent(secret: int) -> None:
    if type(secret) is not int or not 0 <= secret < GROUP_ORDER:
        raise ValueError("secret exponent is outside the subgroup order")


def _require_group_element(value: int) -> None:
    if (
        type(value) is not int
        or not 1 <= value < GROUP_PRIME
        or pow(value, GROUP_ORDER, GROUP_PRIME) != 1
    ):
        raise ValueError("value is not in the declared subgroup")


def _require_message(message: int) -> None:
    if type(message) is not int or not 0 <= message <= MESSAGE_MAX:
        raise ValueError("message must be a 16-bit integer")


def _pad(shared: int, branch: int) -> int:
    digest = hashlib.sha256(f"tc-ot-v1:{shared}:{branch}".encode()).digest()
    return int.from_bytes(digest[:2], "big")


def make_receiver_request(
    sender_public: int, choice: int, receiver_secret: int
) -> int:
    _require_group_element(sender_public)
    _require_choice(choice)
    _require_exponent(receiver_secret)
    receiver_base = pow(GENERATOR, receiver_secret, GROUP_PRIME)
    return receiver_base * pow(sender_public, choice, GROUP_PRIME) % GROUP_PRIME


def seal_sender_messages(
    sender_secret: int,
    request: int,
    message_0: int,
    message_1: int,
) -> tuple[int, int]:
    _require_exponent(sender_secret)
    _require_group_element(request)
    _require_message(message_0)
    _require_message(message_1)
    sender_public = pow(GENERATOR, sender_secret, GROUP_PRIME)
    inverse_public = pow(sender_public, -1, GROUP_PRIME)
    shared_0 = pow(request, sender_secret, GROUP_PRIME)
    shared_1 = pow(request * inverse_public % GROUP_PRIME, sender_secret, GROUP_PRIME)
    return (message_0 ^ _pad(shared_0, 0), message_1 ^ _pad(shared_1, 1))


def open_receiver_message(
    sender_public: int,
    choice: int,
    receiver_secret: int,
    ciphertexts: tuple[int, int],
) -> int:
    _require_group_element(sender_public)
    _require_choice(choice)
    _require_exponent(receiver_secret)
    if (
        not isinstance(ciphertexts, (tuple, list))
        or len(ciphertexts) != 2
        or any(type(value) is not int or value < 0 for value in ciphertexts)
    ):
        raise ValueError("ciphertexts must contain two non-negative integers")
    shared = pow(sender_public, receiver_secret, GROUP_PRIME)
    return ciphertexts[choice] ^ _pad(shared, choice)
