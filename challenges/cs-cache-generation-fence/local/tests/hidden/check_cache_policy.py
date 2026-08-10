"""Hidden properties for the cache generation-fence exercise."""

from __future__ import annotations

import hashlib
from typing import Any, Protocol


class Submission(Protocol):
    def invalidate(self, cache: dict[str, dict], key: str, committed_revision: int) -> None: ...

    def admit_fill(
        self, cache: dict[str, dict], key: str, value: int, revision: int
    ) -> bool: ...


def _state(entries: dict[str, dict[str, int]] | None = None) -> dict[str, dict[str, Any]]:
    return {"entries": {k: dict(v) for k, v in (entries or {}).items()}, "floors": {}}


def _case(seed: str, label: str) -> tuple[str, int, int]:
    """Return an unseen key, revision, and value without timing or randomness."""
    digest = hashlib.sha256(f"{seed}:{label}".encode()).digest()
    key = f"sku-{label}-{digest.hex()[:8]}"
    revision = 20 + int.from_bytes(digest[4:8], "big") % 900
    value = 100 + int.from_bytes(digest[8:12], "big") % 9_000
    return key, revision, value


def _invalidate(
    module: Submission, cache: dict[str, dict[str, Any]], key: str, revision: int
) -> list[str]:
    try:
        module.invalidate(cache, key, revision)
    except Exception as error:  # noqa: BLE001
        return [f"invalidate raised {type(error).__name__}"]
    if not isinstance(cache.get("entries"), dict) or not isinstance(cache.get("floors"), dict):
        return ["cache state no longer has entries and floors dictionaries"]
    return []


def _admit(
    module: Submission,
    cache: dict[str, dict[str, Any]],
    key: str,
    value: int,
    revision: int,
) -> tuple[bool | None, list[str]]:
    try:
        result = module.admit_fill(cache, key, value, revision)
    except Exception as error:  # noqa: BLE001
        return None, [f"admit_fill raised {type(error).__name__}"]
    if type(result) is not bool:
        return None, ["admit_fill did not return a bool"]
    if not isinstance(cache.get("entries"), dict) or not isinstance(cache.get("floors"), dict):
        return None, ["cache state no longer has entries and floors dictionaries"]
    return result, []


def check_basic_invalidate(module: Submission, seed: str) -> list[str]:
    target, old_revision, old_value = _case(seed, "basic-target")
    other, other_revision, other_value = _case(seed, "basic-other")
    committed_revision = old_revision + 3
    cache = _state(
        {
            target: {"value": old_value, "revision": old_revision},
            other: {"value": other_value, "revision": other_revision},
        }
    )
    failures = _invalidate(module, cache, target, committed_revision)
    if failures:
        return failures
    if target in cache["entries"]:
        failures.append("invalidated entry remained cached")
    if cache["entries"].get(other) != {"value": other_value, "revision": other_revision}:
        failures.append("invalidating one key changed another key")
    if cache["floors"].get(target) != committed_revision:
        failures.append("invalidation did not retain the committed revision")
    return failures


def check_fence(module: Submission, seed: str) -> list[str]:
    key, floor, current_value = _case(seed, "race")
    old_revision = floor - 1
    old_value = current_value - 1
    cache = _state()
    failures = _invalidate(module, cache, key, floor)
    if failures:
        return failures

    admitted, errors = _admit(module, cache, key, old_value, old_revision)
    failures.extend(errors)
    if admitted is not False:
        failures.append("a fill older than the invalidation floor was admitted")
    if key in cache["entries"]:
        failures.append("a rejected old fill still changed the cache")

    admitted, errors = _admit(module, cache, key, current_value, floor)
    failures.extend(errors)
    if admitted is not True:
        failures.append("a fill at the current committed revision was rejected")
    if cache["entries"].get(key) != {"value": current_value, "revision": floor}:
        failures.append("the current fill was not stored with its revision")

    # Capacity eviction removes an entry, not knowledge that a newer origin revision
    # exists.  Keeping the floor only as long as the entry happens to be resident lets
    # the same old in-flight read resurrect after eviction.
    cache["entries"].pop(key, None)
    admitted, errors = _admit(module, cache, key, old_value, old_revision)
    failures.extend(errors)
    if admitted is not False or key in cache["entries"]:
        failures.append("a late fill returned after entry eviction and resurrected old data")
    return failures


def check_per_key(module: Submission, seed: str) -> list[str]:
    target, floor, target_value = _case(seed, "per-key-target")
    other, _unused_revision, other_value = _case(seed, "per-key-other")
    # Make the unrelated key deliberately older than the target's floor.  A
    # correct per-key policy accepts it; a single global floor blocks it.
    other_revision = floor - 5
    cache = _state({other: {"value": other_value, "revision": other_revision}})
    failures = _invalidate(module, cache, target, floor)
    if failures:
        return failures
    admitted, errors = _admit(module, cache, other, other_value + 1, other_revision + 1)
    failures.extend(errors)
    if admitted is not True:
        failures.append("an invalidation for one key blocked a current fill for another")
    if cache["entries"].get(other) != {
        "value": other_value + 1,
        "revision": other_revision + 1,
    }:
        failures.append("another key did not retain its current fill")
    admitted, errors = _admit(module, cache, target, target_value, floor - 1)
    failures.extend(errors)
    if admitted is not False:
        failures.append("the target key did not retain its own invalidation floor")
    return failures


def _check_monotonic_floor(module: Submission, seed: str) -> list[str]:
    key, floor, value = _case(seed, "monotonic")
    cache = _state()
    failures = _invalidate(module, cache, key, floor)
    failures.extend(_invalidate(module, cache, key, floor - 10))
    if failures:
        return failures
    if cache["floors"].get(key) != floor:
        failures.append("an older invalidation moved the generation floor backwards")
    admitted, errors = _admit(module, cache, key, value - 1, floor - 1)
    failures.extend(errors)
    if admitted is not False:
        failures.append("a fill below the highest known revision was admitted")
    admitted, errors = _admit(module, cache, key, value, floor)
    failures.extend(errors)
    if admitted is not True:
        failures.append("the exact floor revision was not admissible")
    return failures


def _check_newer_entry_wins(module: Submission, seed: str) -> list[str]:
    key, newer_revision, value = _case(seed, "newer-entry")
    cache = _state()
    failures: list[str] = []
    admitted, errors = _admit(module, cache, key, value, newer_revision)
    failures.extend(errors)
    if admitted is not True:
        failures.append("a first stable fill was rejected")
        return failures
    admitted, errors = _admit(module, cache, key, value - 1, newer_revision - 1)
    failures.extend(errors)
    if admitted is not False:
        failures.append("an older completion overwrote a newer cached entry")
    if cache["entries"].get(key) != {"value": value, "revision": newer_revision}:
        failures.append("the newer cached entry was not preserved")
    return failures


def check_generalize(module: Submission, seed: str) -> list[str]:
    failures = check_basic_invalidate(module, seed)
    failures.extend(check_fence(module, seed))
    failures.extend(check_per_key(module, seed))
    failures.extend(_check_monotonic_floor(module, seed))
    failures.extend(_check_newer_entry_wins(module, seed))
    return failures
