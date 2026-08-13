"""Admission policy for a tiny versioned cache.

Prerequisites: Python dictionaries and functions.

Vocabulary
----------
origin
    The source of truth.  Each committed value carries an integer ``revision``.
fill
    A value read from origin after a cache miss, waiting to be stored in the cache.
invalidate
    Notification that ``key`` has committed at ``committed_revision``.  An older
    cached entry must disappear.
generation floor
    ``cache["floors"][key]``.  A fill older than this number began before a known
    update and must not be admitted, even if it finishes after invalidation.

State shape::

    cache = {
        "entries": {"sku-1": {"value": 500, "revision": 7}},
        "floors": {"sku-1": 7},
    }

Both functions mutate ``cache``.  ``admit_fill`` returns True only when it stores
the fill.  The public examples cover sequential traffic.  Audit the race shown by
Participant Portal before treating those examples as a proof.
"""

from __future__ import annotations

from typing import Any


CacheState = dict[str, dict[str, Any]]


def invalidate(cache: CacheState, key: str, committed_revision: int) -> None:
    """Remove the entry for ``key`` after origin commits a new revision."""
    cache["entries"].pop(key, None)


def admit_fill(
    cache: CacheState,
    key: str,
    value: int,
    revision: int,
) -> bool:
    """Store an origin read that completed after a cache miss."""
    cache["entries"][key] = {"value": value, "revision": revision}
    return True
