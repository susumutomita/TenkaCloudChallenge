"""Seed-derived evidence for the atomic-publish lab."""

from __future__ import annotations

import hashlib
import random


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _token(seed: str, label: str, width: int = 10) -> str:
    return hashlib.sha256(f"{seed}:{label}".encode()).hexdigest()[:width]


def health_token(seed: str) -> str:
    return f"publish-lab-{_token(seed, 'health', 12)}"


def published_document(seed: str) -> dict[str, object]:
    rng = _rng(seed, "document")
    return {
        "path": f"/srv/app/config-{_token(seed, 'name', 6)}.json",
        "revision": f"rev-{_token(seed, 'revision', 8)}",
        "bytes": rng.randrange(4, 40) * 1024,
    }


def reader_observations(seed: str) -> list[dict[str, object]]:
    """A reader's log across one publish, with the moment the file was incomplete.

    Only the reader's own view is recorded: how many bytes it read and whether the
    document parsed. Nothing here says which write caused it — that is the audit.
    """
    document = published_document(seed)
    full = int(document["bytes"])
    rng = _rng(seed, "observations")
    previous = full - rng.randrange(200, 900)
    # The number of healthy reads before and after the torn window moves with the seed,
    # so the answer is a position in *this* deployment's log rather than a fixed pair.
    leading = rng.randrange(2, 6)
    trailing = rng.randrange(2, 5)
    rows: list[dict[str, object]] = []
    for index in range(leading):
        rows.append(
            {
                "at": f"t+{index * 40}ms",
                "bytesRead": previous,
                "parsed": True,
                "revision": f"rev-{_token(seed, 'previous-revision', 8)}",
            }
        )
    rows.append(
        {
            "at": "t+120ms",
            "bytesRead": 0,
            "parsed": False,
            "error": "unexpected end of input at line 1",
        }
    )
    rows.append(
        {
            "at": "t+124ms",
            "bytesRead": rng.randrange(300, max(700, full // 3)),
            "parsed": False,
            "error": "unexpected end of input",
        }
    )
    for index in range(trailing):
        rows.append(
            {
                "at": f"t+{160 + index * 40}ms",
                "bytesRead": full,
                "parsed": True,
                "revision": document["revision"],
            }
        )
    return rows


def crash_survivors(seed: str) -> list[dict[str, object]]:
    """What three machines held after power was cut during the same rollout."""
    document = published_document(seed)
    full = int(document["bytes"])
    rng = _rng(seed, "crash")
    return [
        {
            "host": f"web-{_token(seed, 'host-a', 4)}",
            "bytesOnDisk": full,
            "parsed": True,
            "revision": document["revision"],
            "leftoverFiles": [],
        },
        {
            "host": f"web-{_token(seed, 'host-b', 4)}",
            "bytesOnDisk": rng.randrange(100, max(400, full // 2)),
            "parsed": False,
            "revision": None,
            "leftoverFiles": [],
        },
        {
            "host": f"web-{_token(seed, 'host-c', 4)}",
            "bytesOnDisk": 0,
            "parsed": False,
            "revision": None,
            "leftoverFiles": [f".config-{_token(seed, 'name', 6)}.json.{_token(seed, 'debris', 6)}"],
        },
    ]


# Every question the participant is asked, in one place because both the CLI (`show.py`)
# and the Portal (`workbench/server.py`) render them. Japanese is the default and English
# lives under `i18n.en`, the same convention metadata.json uses. Before this existed the
# text sat in show.py alone and the Portal asked the participant nothing at all.
QUESTIONS = {
    "observe": {
        "question": (
            "writer は成功を報告し、ディスク上のバイト列も正しくなっています。 それでも t+120ms の reader は、何を掴んでいた可能性がありますか。"
        ),
        "answerFormat": (
            '["<document.path>", "<whole-old | whole-new | partial のいずれか 1 つ>"]'
        ),
        "i18n": {
            "en": {
                "question": (
                    "The writer reported success and the bytes on disk are correct. "
                    "What could this reader have been holding at t+120ms?"
                ),
                "answerFormat": (
                    '["<document.path>", "<one of: whole-old | whole-new | partial>"]'
                ),
            }
        },
    },
    "audit": {
        "question": (
            "publish が atomic であったなら、そもそも起こり得なかった観測を 1 つ残らず挙げてください。"
        ),
        "answerFormat": "[<index>, ...] (昇順、重複なし)",
        "i18n": {
            "en": {
                "question": (
                    "List every observation that could not have happened if the publish had been atomic."
                ),
                "answerFormat": "[<index>, ...] (ascending, no duplicates)",
            }
        },
    },
}
