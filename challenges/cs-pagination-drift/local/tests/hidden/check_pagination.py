"""Hidden property checks for the three code checkpoints.

The claim is about a table that changes while it is being paged — a situation no
public test creates. Nothing here is timing-dependent: the checker owns the store
and applies every write itself, between page calls, at deterministic points.

The properties are stated against the contract, not against one implementation:

  * shape       — replies are well-formed and strictly newest-first
  * no repeat   — no row id is served twice in one iteration
  * survivors   — a row alive at the start and at the end is served exactly once
  * freshness   — a served row was alive in the table when its page returned
  * termination — ``cursor`` is ``None`` exactly when nothing older remains
  * refusal     — an input the paginator never issued is refused, and a refused
                  call does not disturb the iteration

An offset paginator passes every one of these while the table holds still. Each
of the last three phases moves the table a little more.
"""

from __future__ import annotations

import hashlib
import random
from types import ModuleType

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fixtures.generate import MemoryStore

PAGE_CAP = 60
BAD_SIZES = (0, -1, 101, "3", True, 2.5, None)
BAD_CURSORS = ("", "abc", "-3", "0", "1.5", "12x", " 7", 7, 3.5, ["2"], {"page": 2})


def _rng(seed: str, label: str) -> random.Random:
    digest = hashlib.sha256(f"{seed}:{label}".encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:16], "big"))


def _store(ids: list[int]) -> MemoryStore:
    return MemoryStore([{"id": row_id, "value": f"row-{row_id}"} for row_id in sorted(ids)])


def _new(module: ModuleType, store: MemoryStore) -> object:
    try:
        return module.new_paginator(store)
    except Exception as error:  # noqa: BLE001 - a paginator that cannot start is a failure
        return error


def _call(paginator: object, size: object, cursor: object) -> object:
    try:
        return paginator.page(size, cursor)
    except Exception as error:  # noqa: BLE001 - participant exceptions are a failed property
        return {"raised": type(error).__name__}


def _alive(store: MemoryStore) -> set[int]:
    return {int(row["id"]) for row in store.rows()}


def _well_formed(reply: object) -> str | None:
    if not isinstance(reply, dict) or reply.get("ok") is not True:
        # §15: a full reply repr can dump table rows wholesale; name the property only.
        return "a valid page call did not return ok"
    items = reply.get("items")
    if not isinstance(items, list):
        return "a page reply carried no items list"
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), int):
            return f"a served item is not a row dict: {item!r}"
    cursor = reply.get("cursor")
    if cursor is not None and not isinstance(cursor, str):
        return f"a cursor must be a string or None, got {cursor!r}"
    return None


def _iterate(
    module: ModuleType,
    store: MemoryStore,
    size: int,
    ops: dict[int, list[tuple[str, int]]] | None = None,
) -> tuple[list[list[int]], set[int], str | None]:
    """Drive one full iteration, applying ``ops`` after the numbered page.

    Returns the served pages, the ids alive at the start, and the first broken
    property (or None). Writes happen strictly *between* page calls, so every
    assertion is about a moment the paginator could have observed.
    """
    alive_at_start = _alive(store)
    paginator = _new(module, store)
    if not hasattr(paginator, "page"):
        return [], alive_at_start, "new_paginator() did not return an object with page()"

    pages: list[list[int]] = []
    served: list[int] = []
    cursor: object = None
    for page_number in range(1, PAGE_CAP + 1):
        reply = _call(paginator, size, cursor)
        malformed = _well_formed(reply)
        if malformed is not None:
            return pages, alive_at_start, malformed
        items = [int(item["id"]) for item in reply["items"]]
        alive_now = _alive(store)

        for row_id in items:
            if row_id not in alive_now:
                return pages, alive_at_start, (
                    f"page {page_number} served row {row_id}, which was no longer in the table"
                )
        flat = served + items
        if any(later >= earlier for earlier, later in zip(flat, flat[1:])):
            return pages, alive_at_start, (
                f"page {page_number} broke the newest-first order across the iteration"
            )
        if len(set(flat)) != len(flat):
            repeated = sorted({row_id for row_id in items if served.count(row_id)})
            return pages, alive_at_start, (
                f"page {page_number} served row(s) {repeated} a second time"
            )
        served = flat
        pages.append(items)

        floor = served[-1] if served else None
        remaining = {row_id for row_id in alive_now if floor is None or row_id < floor}
        cursor = reply["cursor"]
        if (cursor is None) != (len(remaining) == 0):
            state = "nothing" if not remaining else f"{len(remaining)} row(s)"
            return pages, alive_at_start, (
                f"page {page_number} said cursor={cursor!r} while {state} older remained"
            )
        if cursor is None:
            return pages, alive_at_start, None
        for op, row_id in (ops or {}).get(page_number, []):
            if op == "insert":
                store.insert(row_id, f"row-{row_id}")
            else:
                store.delete(row_id)
    return pages, alive_at_start, f"the iteration did not finish within {PAGE_CAP} pages"


def _survivor_failures(pages: list[list[int]], alive_at_start: set[int], store: MemoryStore) -> list[str]:
    served: list[int] = [row_id for page in pages for row_id in page]
    survivors = alive_at_start & _alive(store)
    missing = sorted(row_id for row_id in survivors if served.count(row_id) == 0)
    if missing:
        return [f"row(s) {missing} were in the table the whole time and never appeared on any page"]
    return []


def _paginate_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The still-table contract: coverage, edges, refusal, isolation."""
    failures: list[str] = []
    rng = _rng(seed, f"{phase}:static")
    base = rng.randrange(1, 300)
    ids = list(range(base, base + 10))

    for size in (1, 3, 4, 10, 11):
        store = _store(ids)
        pages, alive_at_start, broken = _iterate(module, store, size)
        if broken is not None:
            failures.append(f"with a still table and size {size}: {broken}")
            return failures
        failures.extend(_survivor_failures(pages, alive_at_start, store))
        if failures:
            return failures

    store = _store([])
    reply = _call(_new(module, store), 3, None)
    if _well_formed(reply) is not None or reply.get("items") != [] or reply.get("cursor") is not None:
        failures.append("an empty table did not produce an empty final page")

    store = _store(ids)
    paginator = _new(module, store)
    for size in BAD_SIZES:
        reply = _call(paginator, size, None)
        if reply != {"ok": False, "error": "invalid_size"}:
            failures.append("a size that is not a usable page size was not refused with invalid_size")
            return failures
    for cursor in BAD_CURSORS:
        reply = _call(paginator, 3, cursor)
        if reply != {"ok": False, "error": "invalid_cursor"}:
            failures.append(
                # §15: the probe cursors are hidden test data; naming one invites refusing
                # exactly it instead of validating cursors.
                "a cursor this paginator never issued was not refused with invalid_cursor"
            )
            return failures

    # A refused call must not disturb the iteration a valid cursor continues.
    store = _store(ids)
    paginator = _new(module, store)
    first = _call(paginator, 3, None)
    if _well_formed(first) is None:
        checkpoint = first["cursor"]
        _call(paginator, 0, None)
        _call(paginator, 3, "not-a-cursor")
        resumed = _call(paginator, 3, checkpoint)
        expected = [row_id for row_id in sorted(ids, reverse=True)[3:6]]
        got = [int(item["id"]) for item in resumed.get("items", [])] if isinstance(resumed, dict) else None
        if _well_formed(resumed) is not None or got != expected:
            failures.append("a refused call disturbed the iteration a valid cursor was continuing")

    # Two iterations over the same table stay independent.
    store = _store(ids)
    first_paginator = _new(module, store)
    second_paginator = _new(module, store)
    first_reply = _call(first_paginator, 4, None)
    second_reply = _call(second_paginator, 2, None)
    descending = sorted(ids, reverse=True)
    first_ok = isinstance(first_reply, dict) and [int(i["id"]) for i in first_reply.get("items", [])] == descending[:4]
    second_ok = isinstance(second_reply, dict) and [int(i["id"]) for i in second_reply.get("items", [])] == descending[:2]
    if not (first_ok and second_ok):
        failures.append("two paginators over the same table did not iterate independently")
    return failures


def _stability_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """The moving-table cases the problem exists for."""
    failures = _paginate_properties(module, seed, phase)
    if failures:
        return failures
    rng = _rng(seed, f"{phase}:moving")
    base = rng.randrange(1, 300)
    ids = list(range(base, base + 9))
    top = base + 9

    # Rows arrive between pages: the window slides and the tail repeats.
    store = _store(ids)
    pages, alive_at_start, broken = _iterate(
        module, store, 3, ops={1: [("insert", top), ("insert", top + 1)]}
    )
    if broken is not None:
        failures.append(f"after an insert between pages: {broken}")
        return failures
    failures.extend(_survivor_failures(pages, alive_at_start, store))
    if failures:
        return failures

    # Rows you already handled get deleted: the window slides the other way and
    # rows nobody served yet fall out of it.
    store = _store(ids)
    served_first = sorted(ids, reverse=True)[:3]
    pages, alive_at_start, broken = _iterate(
        module, store, 3, ops={1: [("delete", served_first[0]), ("delete", served_first[1])]}
    )
    if broken is not None:
        failures.append(f"after deleting already-served rows: {broken}")
        return failures
    failures.extend(_survivor_failures(pages, alive_at_start, store))
    if failures:
        return failures

    # A row deleted before it was served must not surface later from a stale copy.
    store = _store(ids)
    unserved = sorted(ids, reverse=True)[4]
    pages, alive_at_start, broken = _iterate(module, store, 3, ops={1: [("delete", unserved)]})
    if broken is not None:
        failures.append(f"after deleting a not-yet-served row: {broken}")
        return failures
    failures.extend(_survivor_failures(pages, alive_at_start, store))

    # Both directions in one iteration.
    store = _store(ids)
    pages, alive_at_start, broken = _iterate(
        module,
        store,
        3,
        ops={1: [("insert", top + 2)], 2: [("delete", sorted(ids, reverse=True)[0])]},
    )
    if broken is not None:
        failures.append(f"with an insert and a delete in one iteration: {broken}")
        return failures
    failures.extend(_survivor_failures(pages, alive_at_start, store))
    return failures


def _generalize_properties(module: ModuleType, seed: str, phase: str) -> list[str]:
    """Seeded schedules the author never wrote down by hand."""
    failures = _stability_properties(module, seed, phase)
    if failures:
        return failures
    rng = _rng(seed, f"{phase}:sweep")

    for round_number in range(18):
        base = rng.randrange(1, 500)
        count = rng.randrange(0, 15)
        size = rng.randrange(1, 6)
        ids = list(range(base, base + count))
        store = _store(ids)
        next_id = base + count

        ops: dict[int, list[tuple[str, int]]] = {}
        alive = set(ids)
        for page_number in range(1, 7):
            steps: list[tuple[str, int]] = []
            for _ in range(rng.randrange(0, 3)):
                if alive and rng.random() < 0.5:
                    victim = rng.choice(sorted(alive))
                    steps.append(("delete", victim))
                    alive.discard(victim)
                else:
                    steps.append(("insert", next_id))
                    alive.add(next_id)
                    next_id += 1
            if steps:
                ops[page_number] = steps

        pages, alive_at_start, broken = _iterate(module, store, size, ops)
        if broken is not None:
            return failures + [f"seeded schedule {round_number} (size {size}): {broken}"]
        survivor_failures = _survivor_failures(pages, alive_at_start, store)
        if survivor_failures:
            return failures + [f"seeded schedule {round_number} (size {size}): {survivor_failures[0]}"]
    return failures


def check_paginate(module: ModuleType, seed: str) -> list[str]:
    return _paginate_properties(module, seed, "paginate-checkpoint")


def check_stability(module: ModuleType, seed: str) -> list[str]:
    return _stability_properties(module, seed, "stability-checkpoint")


def check_generalize(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "generalize-checkpoint")


def run(module: ModuleType, seed: str) -> list[str]:
    return _generalize_properties(module, seed, "full-run")
