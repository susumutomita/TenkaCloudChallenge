"""Reference generation-fence policy."""

from __future__ import annotations

from typing import Any


CacheState = dict[str, dict[str, Any]]


def invalidate(cache: CacheState, key: str, committed_revision: int) -> None:
    entries = cache["entries"]
    floors = cache["floors"]
    current = floors.get(key, -1)
    floor = max(current, committed_revision)
    floors[key] = floor
    entry = entries.get(key)
    if entry is not None and entry.get("revision", -1) < floor:
        entries.pop(key, None)


def admit_fill(
    cache: CacheState,
    key: str,
    value: int,
    revision: int,
) -> bool:
    entries = cache["entries"]
    floors = cache["floors"]
    floor = floors.get(key, -1)
    if revision < floor:
        return False
    existing = entries.get(key)
    if existing is not None and existing.get("revision", -1) > revision:
        return False
    entries[key] = {"value": value, "revision": revision}
    return True
