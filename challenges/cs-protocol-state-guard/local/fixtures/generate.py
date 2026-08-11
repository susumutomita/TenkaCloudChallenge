"""Seed-derived evidence for the session-protocol lab."""

from __future__ import annotations

import hashlib
import random

# The order a well-behaved client follows. The transcript below does not.
HAPPY_PATH = ("HELLO", "AUTH", "DATA", "DATA", "BYE")


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"session-lab-{_token(seed, 'health', 12)}"


def reported_session(seed: str) -> dict[str, object]:
    rng = _rng(seed, "session")
    return {
        "sessionId": f"sess-{_token(seed, 'session-id', 8)}",
        "peer": f"10.{rng.randrange(0, 255)}.{rng.randrange(0, 255)}.{rng.randrange(1, 254)}",
        "openedAt": f"2026-08-11T0{rng.randrange(1, 9)}:{rng.randrange(10, 59)}:00Z",
    }


def session_transcript(seed: str) -> list[dict[str, object]]:
    """What the server replied to each message of one recorded session.

    Only the exchange is recorded: the message that arrived and the reply that went
    back. Nothing here says which replies were wrong — that is the audit.
    """
    rng = _rng(seed, "transcript")
    # Where the client skips ahead moves with the seed, so the answer is a position in
    # *this* deployment's transcript rather than a fixed pair.
    leading_data = rng.randrange(1, 4)
    trailing_data = rng.randrange(1, 4)

    rows: list[dict[str, object]] = [
        {"received": "HELLO", "reply": {"ok": True, "state": "greeted"}},
    ]
    # The client never authenticates, and the server keeps saying yes.
    for index in range(leading_data):
        rows.append(
            {
                "received": "DATA",
                "payload": f"pay-{_token(seed, f'early-{index}', 6)}",
                "reply": {"ok": True, "state": "ready", "accepted": index + 1},
            }
        )
    rows.append({"received": "AUTH", "reply": {"ok": True, "state": "ready"}})
    for index in range(trailing_data):
        rows.append(
            {
                "received": "DATA",
                "payload": f"pay-{_token(seed, f'late-{index}', 6)}",
                "reply": {"ok": True, "state": "ready", "accepted": leading_data + index + 1},
            }
        )
    rows.append({"received": "BYE", "reply": {"ok": True, "state": "closed"}})
    # And one more after the goodbye, which was also accepted.
    rows.append(
        {
            "received": "DATA",
            "payload": f"pay-{_token(seed, 'after-bye', 6)}",
            "reply": {
                "ok": True,
                "state": "ready",
                "accepted": leading_data + trailing_data + 1,
            },
        }
    )
    return rows


# Every question the participant is asked, in one place because both the CLI (`show.py`)
# and the Portal (`workbench/server.py`) render them. Japanese is the default and English
# lives under `i18n.en`, the same convention metadata.json uses. Before this existed the
# text sat in show.py alone and the Portal asked the participant nothing at all.
QUESTIONS = {
    "observe": {
        "question": (
            "返答はすべて ok です。 server はこの client に何を許してしまいましたか。"
        ),
        "i18n": {"en": {"question": "Every reply here says ok. What did the server let this client do?"}},
    },
    "audit": {
        "question": (
            "documentedOrder に照らして、届いた時点では受理されるべきでなかった交換を 1 つ残らず挙げてください。"
        ),
        "answerFormat": "[<index>, ...] (昇順、重複なし)",
        "i18n": {
            "en": {
                "question": (
                    "List every exchange that should not have been accepted at the point it arrived, judged against documentedOrder."
                ),
                "answerFormat": "[<index>, ...] (ascending, no duplicates)",
            }
        },
    },
}
