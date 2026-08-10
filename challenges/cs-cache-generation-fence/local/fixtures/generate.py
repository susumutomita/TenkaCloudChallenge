"""Seeded evidence and deterministic cache-race fixtures.

There are no threads or sleeps in this lab.  A trace is an explicit ordering of
events, which makes the interesting interleaving reproducible on every machine.
"""

from __future__ import annotations

import hashlib
import random
from typing import Any


CacheState = dict[str, dict[str, Any]]


def _rng(seed: str, namespace: str) -> random.Random:
    digest = hashlib.sha256(f"{namespace}:{seed}".encode()).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def health_token(seed: str) -> str:
    suffix = hashlib.sha256(f"health:{seed}".encode()).hexdigest()[:12]
    return f"cache-lab-{suffix}"


def product_keys(seed: str) -> tuple[str, str, str]:
    rng = _rng(seed, "products")
    numbers = rng.sample(range(100, 999), 3)
    return tuple(f"sku-{number}" for number in numbers)  # type: ignore[return-value]


def new_state(entries: dict[str, dict[str, int]] | None = None) -> CacheState:
    return {
        "entries": {key: dict(value) for key, value in (entries or {}).items()},
        "floors": {},
    }


def _episode(key: str, revision: int, value: int, kind: str) -> list[dict[str, object]]:
    if kind == "stable":
        return [
            {"op": "origin_commit", "key": key, "revision": revision, "value": value},
            {"op": "cache_miss", "key": key},
            {"op": "fill_complete", "key": key, "revision": revision, "value": value},
            {"op": "cache_hit", "key": key, "revision": revision, "value": value},
        ]
    if kind == "stale":
        return [
            {"op": "origin_commit", "key": key, "revision": revision, "value": value},
            {"op": "cache_miss", "key": key},
            {
                "op": "origin_commit",
                "key": key,
                "revision": revision + 1,
                "value": value + 7,
            },
            {"op": "invalidate", "key": key, "revision": revision + 1},
            {"op": "fill_complete", "key": key, "revision": revision, "value": value},
            {"op": "cache_hit", "key": key, "revision": revision, "value": value},
        ]
    return [
        {"op": "origin_commit", "key": key, "revision": revision, "value": value},
        {"op": "cache_miss", "key": key},
        {"op": "fill_complete", "key": key, "revision": revision, "value": value},
        {
            "op": "origin_commit",
            "key": key,
            "revision": revision + 2,
            "value": value + 11,
        },
        {"op": "invalidate", "key": key, "revision": revision + 2},
        {"op": "cache_miss", "key": key},
        {
            "op": "fill_complete",
            "key": key,
            "revision": revision + 2,
            "value": value + 11,
        },
        {
            "op": "cache_hit",
            "key": key,
            "revision": revision + 2,
            "value": value + 11,
        },
    ]


def audit_trace(seed: str) -> list[dict[str, object]]:
    """Return participant-visible evidence without computing a checkpoint answer."""
    rng = _rng(seed, "audit")
    keys = product_keys(seed)
    revisions = [rng.randint(10, 80) for _ in keys]
    values = [rng.randint(120, 990) for _ in keys]
    episodes = [
        _episode(keys[0], revisions[0], values[0], "stable"),
        _episode(keys[1], revisions[1], values[1], "stale"),
        _episode(keys[2], revisions[2], values[2], "fresh"),
    ]
    rng.shuffle(episodes)

    rows: list[dict[str, object]] = []
    for episode in episodes:
        # Harmless request rows vary the answer's position without changing causality.
        for _ in range(rng.randint(0, 2)):
            rows.append({"op": "request_received", "requestId": f"r-{rng.randrange(10_000):04d}"})
        rows.extend(episode)

    return rows


def race_evidence(seed: str) -> dict[str, object]:
    rng = _rng(seed, "race")
    key = product_keys(seed)[1]
    old_revision = rng.randint(20, 70)
    old_value = rng.randint(200, 800)
    new_revision = old_revision + rng.randint(1, 4)
    new_value = old_value + rng.randint(5, 30)
    return {
        "key": key,
        "timeline": [
            {"step": 1, "event": "cache_miss", "originRevision": old_revision},
            {"step": 2, "event": "origin_read_started", "revision": old_revision},
            {"step": 3, "event": "origin_commit", "revision": new_revision, "value": new_value},
            {"step": 4, "event": "invalidate", "revision": new_revision},
            {"step": 5, "event": "old_read_finished", "revision": old_revision, "value": old_value},
            {"step": 6, "event": "next_cache_hit", "revision": old_revision, "value": old_value},
        ],
    }
