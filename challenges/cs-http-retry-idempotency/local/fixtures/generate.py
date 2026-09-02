"""Seed-derived evidence for the retry/idempotency lab."""

from __future__ import annotations

import hashlib
import random


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"retry-lab-{_token(seed, 'health', 12)}"


def public_operation(seed: str) -> dict[str, object]:
    rng = _rng(seed, "operation")
    return {
        "requestId": f"req-{_token(seed, 'request', 8)}",
        "idempotencyKey": f"pay:{_token(seed, 'key', 14)}",
        "request": {
            "account": f"acct-{rng.randrange(100, 999)}",
            "amount": rng.randrange(12, 900) * 100,
            "memo": f"order-{rng.randrange(1000, 9999)}",
        },
    }


def dropped_response_trace(seed: str) -> list[dict[str, object]]:
    operation = public_operation(seed)
    first = f"ch-{_token(seed, 'first-charge', 8)}"
    second = f"ch-{_token(seed, 'second-charge', 8)}"
    return [
        {
            "attempt": 1,
            "requestId": operation["requestId"],
            "idempotencyKey": operation["idempotencyKey"],
            "events": [
                "request_received",
                {"ledger_committed": first},
                "response_dropped_before_client_received_it",
            ],
            "clientObserved": "timeout",
        },
        {
            "attempt": 2,
            "requestId": operation["requestId"],
            "idempotencyKey": operation["idempotencyKey"],
            "events": ["request_received", {"ledger_committed": second}, "response_delivered"],
            "clientObserved": {"status": 201, "chargeId": second},
        },
    ]


def audit_log(seed: str) -> list[dict[str, object]]:
    """Return a short ledger where one retry became a second business effect."""
    operation = public_operation(seed)
    rng = _rng(seed, "audit")
    logical = str(operation["requestId"])
    duplicate_rows = [
        {
            "logicalOperation": logical,
            "idempotencyKey": operation["idempotencyKey"],
            "account": operation["request"]["account"],
            "amount": operation["request"]["amount"],
            "chargeId": f"ch-{_token(seed, 'first-charge', 8)}",
            "attempt": 1,
        },
        {
            "logicalOperation": logical,
            "idempotencyKey": operation["idempotencyKey"],
            "account": operation["request"]["account"],
            "amount": operation["request"]["amount"],
            "chargeId": f"ch-{_token(seed, 'second-charge', 8)}",
            "attempt": 2,
        },
    ]
    ordinary: list[dict[str, object]] = []
    for index in range(7):
        ordinary.append(
            {
                "logicalOperation": f"req-{_token(seed, f'ordinary-{index}', 8)}",
                "idempotencyKey": f"pay:{_token(seed, f'ordinary-key-{index}', 14)}",
                "account": f"acct-{rng.randrange(100, 999)}",
                "amount": rng.randrange(10, 500) * 100,
                "chargeId": f"ch-{_token(seed, f'ordinary-charge-{index}', 8)}",
                "attempt": 1,
            }
        )
    rng.shuffle(ordinary)
    # Keep ledger index in commit order: attempt 1 always precedes attempt 2. Seeded
    # ordinary rows before and between them make the answer deployment-specific without
    # creating the pedagogical contradiction of a "later" retry at an earlier index.
    first_position = rng.randrange(0, 5)
    second_position = rng.randrange(first_position, len(ordinary) + 1)
    rows = [
        *ordinary[:first_position],
        duplicate_rows[0],
        *ordinary[first_position:second_position],
        duplicate_rows[1],
        *ordinary[second_position:],
    ]
    return rows


# Every question the participant is asked, in one place because both the CLI (`show.py`)
# and the Portal (`workbench/server.py`) render them. Japanese is the default and English
# lives under `i18n.en`, the same convention metadata.json uses. Before this existed the
# text sat in show.py alone and the Portal asked the participant nothing at all.
QUESTIONS = {
    "uncertain": {
        "question": (
            "timeout の直後、server 側の状態は created・not-created・unknown のどれですか。"
        ),
        "answerFormat": (
            '["<operation.requestId>", "<created | not-created | unknown のいずれか 1 つ>"]'
        ),
        "i18n": {
            "en": {
                "question": (
                    "Immediately after the timeout, is server state created, not-created, "
                    "or unknown?"
                ),
                "answerFormat": (
                    '["<operation.requestId>", "<one of: created | not-created | unknown>"]'
                ),
            }
        },
    },
    "audit": {
        "question": (
            "1 つの論理操作を二重に記録してしまった ledger 行を、1 つ残らず挙げてください。"
        ),
        "answerFormat": "[<index>, ...] (昇順、重複なし)",
        "i18n": {
            "en": {
                "question": (
                    "List every ledger row that recorded one logical operation a second time."
                ),
                "answerFormat": "[<index>, ...] (ascending, no duplicates)",
            }
        },
    },
}
