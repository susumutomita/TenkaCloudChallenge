"""Seed-derived cases and an independent oracle for the toy OT lab."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

GROUP_PRIME = 467
GROUP_ORDER = 233
GENERATOR = 4
MESSAGE_MAX = (1 << 16) - 1


def _stream(seed: str, label: str) -> list[int]:
    out: list[int] = []
    counter = 0
    while len(out) < 96:
        out.extend(hashlib.sha256(f"{seed}:{label}:{counter}".encode()).digest())
        counter += 1
    return out


def _pick(data: list[int], index: int, low: int, high: int) -> int:
    value = data[index % len(data)] * 256 + data[(index + 1) % len(data)]
    return low + value % (high - low + 1)


def pad(shared: int, branch: int) -> int:
    digest = hashlib.sha256(f"tc-ot-v1:{shared}:{branch}".encode()).digest()
    return int.from_bytes(digest[:2], "big")


@dataclass(frozen=True)
class OtCase:
    sender_secret: int
    sender_public: int
    choice: int
    receiver_secret: int
    message_0: int
    message_1: int

    def public_view(self) -> dict[str, int]:
        return {
            "senderPublic": self.sender_public,
            "choice": self.choice,
            "receiverSecret": self.receiver_secret,
            "message0": self.message_0,
            "message1": self.message_1,
        }


def request_for(sender_public: int, choice: int, receiver_secret: int) -> int:
    base = pow(GENERATOR, receiver_secret, GROUP_PRIME)
    return base * pow(sender_public, choice, GROUP_PRIME) % GROUP_PRIME


def ciphertexts_for(case: OtCase, request: int | None = None) -> tuple[int, int]:
    request = request_for(
        case.sender_public, case.choice, case.receiver_secret
    ) if request is None else request
    inverse_public = pow(case.sender_public, -1, GROUP_PRIME)
    shared_0 = pow(request, case.sender_secret, GROUP_PRIME)
    shared_1 = pow(request * inverse_public % GROUP_PRIME, case.sender_secret, GROUP_PRIME)
    return (
        case.message_0 ^ pad(shared_0, 0),
        case.message_1 ^ pad(shared_1, 1),
    )


def case(seed: str, label: str, choice: int | None = None) -> OtCase:
    data = _stream(seed, f"case:{label}")
    sender_secret = _pick(data, 0, 1, GROUP_ORDER - 1)
    sender_public = pow(GENERATOR, sender_secret, GROUP_PRIME)
    selected = _pick(data, 2, 0, 1) if choice is None else choice
    receiver_secret = _pick(data, 4, 1, GROUP_ORDER - 1)
    message_0 = _pick(data, 8, 0, MESSAGE_MAX)
    message_1 = _pick(data, 12, 0, MESSAGE_MAX)

    # Keep audit cases non-degenerate. A zero pad would make one ciphertext equal
    # its message, and equal chosen/unchosen pads would make a secure transcript look
    # like the receiver can open both branches.
    for _ in range(GROUP_ORDER):
        candidate = OtCase(
            sender_secret,
            sender_public,
            selected,
            receiver_secret,
            message_0,
            message_1,
        )
        request = request_for(sender_public, selected, receiver_secret)
        inverse_public = pow(sender_public, -1, GROUP_PRIME)
        sender_shared = (
            pow(request, sender_secret, GROUP_PRIME),
            pow(request * inverse_public % GROUP_PRIME, sender_secret, GROUP_PRIME),
        )
        receiver_shared = pow(sender_public, receiver_secret, GROUP_PRIME)
        pads = (pad(sender_shared[0], 0), pad(sender_shared[1], 1))
        if (
            pads[0] != 0
            and pads[1] != 0
            and pad(receiver_shared, 1 - selected) != pads[1 - selected]
        ):
            return candidate
        receiver_secret = (receiver_secret + 1) % GROUP_ORDER
    raise RuntimeError("could not derive a non-degenerate OT case")


def cases(seed: str, label: str, count: int = 6) -> list[OtCase]:
    return [case(seed, f"{label}:{index}", index % 2) for index in range(count)]


def health_token(seed: str) -> str:
    first = case(seed, "public", 0)
    return hashlib.sha256(
        f"health:{seed}:{first.sender_public}:{first.message_0}".encode()
    ).hexdigest()[:16]
