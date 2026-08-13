"""Verifier-only direct-answer derivation for the cache evidence."""

from __future__ import annotations

from fixtures.generate import audit_trace


def audit_answer(seed: str) -> list[int]:
    """Return stale cache-hit indices by replaying the public evidence."""
    origin_revision: dict[str, int] = {}
    stale: list[int] = []
    for index, row in enumerate(audit_trace(seed)):
        key = row.get("key")
        revision = row.get("revision")
        if row.get("op") == "origin_commit" and isinstance(key, str) and type(revision) is int:
            origin_revision[key] = revision
        if row.get("op") == "cache_hit" and isinstance(key, str) and type(revision) is int:
            if revision < origin_revision.get(key, revision):
                stale.append(index)
    return stale
